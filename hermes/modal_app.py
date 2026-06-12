"""
WorkDaemon × Hermes Agent runtime on Modal — CLEAN-IMAGE build.

Installs the Hermes CLI into a clean debian_slim image that runs as ROOT — which
removes every wall the prebuilt Docker image hit (s6/PID-1, non-root user, /pkg).
Hermes serves its OpenAI-compatible gateway on :8642; WorkDaemon's `hermes` chat
provider proxies to it. (No Volume yet — this stage proves the gateway serves;
persistence/profiles come next.)

DEPLOY:
    modal secret create hermes-<company> API_SERVER_KEY=… HERMES_ADMIN_TOKEN=… DEEPSEEK_API_KEY=…
    HERMES_COMPANY=<company> modal deploy hermes/modal_app.py
"""
import os
import subprocess

import modal

COMPANY = os.environ.get("HERMES_COMPANY", "default")
app = modal.App(f"workdaemon-hermes-{COMPANY}")

# Warm pool. The SHARED gateway (HERMES_COMPANY unset → "default") is the platform
# default daemon for every keyless workspace, so it MUST stay warm: a scale-to-zero
# cold start boots a container and loads a ~32B model — far longer than the chat-side
# 35s Hermes timeout — so every first-message-after-idle times out and falls to the
# cloud, which is the ~90s latency. Default the shared gateway to a warm pool of 1;
# dedicated per-company gateways keep $0-idle scale-to-zero. Override either with
# HERMES_MIN_CONTAINERS=<n>.
_DEFAULT_MIN = 1 if COMPANY == "default" else 0
GATEWAY_MIN = int(os.environ.get("HERMES_MIN_CONTAINERS", str(_DEFAULT_MIN)))

HERMES_BIN = "/usr/local/bin/hermes"  # install.sh links it here

# Clean image: install the Hermes CLI as root. No s6, no non-root user, no /opt/data.
image = (
    modal.Image.debian_slim(python_version="3.11")
    # Node 20 (for npx-based MCP servers, e.g. GitHub) alongside curl/git.
    .apt_install("curl", "ca-certificates", "git")
    .run_commands(
        "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -",
        "apt-get install -y nodejs",
        "node --version && npm --version",
        "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash",
        f"test -x {HERMES_BIN}",  # fail the build loudly if the CLI didn't land
        # Pre-install the GitHub MCP server so cold starts don't re-download it.
        "npm install -g @modelcontextprotocol/server-github",
    )
    # Company-Brain MCP tool runs as a local stdio subprocess inside the gateway
    # container — bundle it + its deps into the image.
    .pip_install("mcp[cli]", "httpx")
    .add_local_file("hermes/brain_mcp.py", "/root/hermes/brain_mcp.py")
)

secret = modal.Secret.from_name(f"hermes-{COMPANY}")
# NOTE: a Volume CANNOT be mounted at /root/.hermes — the Hermes install populates
# that path (skills/), and Modal refuses to mount over a non-empty image path. So
# persistence for per-staff profiles / per-user tool connections must relocate the
# Hermes home to an empty Volume-backed path (set HOME + seed skills on first boot)
# — a deliberate next step, NOT a mount over /root/.hermes.
BASE = dict(image=image, secrets=[secret], memory=2048)


def _env():
    return {**os.environ, "PATH": f"/usr/local/bin:/root/.local/bin:{os.environ.get('PATH', '')}"}


def _hermes(*args, **kw):
    return subprocess.run([HERMES_BIN, *args], env=_env(), **kw)


# ── One-shot diagnostic: `modal run hermes/modal_app.py::diag` ────────────────
@app.function(image=image, secrets=[secret], memory=2048, timeout=300)
def diag():
    import pathlib, time, socket
    home = pathlib.Path("/root/.hermes")
    home.mkdir(parents=True, exist_ok=True)
    (home / ".env").write_text(
        "API_SERVER_ENABLED=true\n"
        f"API_SERVER_KEY={os.environ.get('API_SERVER_KEY', '')}\n"
        "API_SERVER_HOST=0.0.0.0\n"
        "API_SERVER_PORT=8642\nGATEWAY_ALLOW_ALL_USERS=true\n"
        f"DEEPSEEK_API_KEY={os.environ.get('DEEPSEEK_API_KEY', '')}\n"
    )
    for k in ("DEEPSEEK_API_KEY", "API_SERVER_KEY", "HERMES_ADMIN_TOKEN"):
        v = os.environ.get(k, "")
        print(f">>> env {k}: len={len(v)} prefix={v[:6]}", flush=True)
    _hermes("config", "set", "model.provider", "custom", check=False)
    _hermes("config", "set", "model.base_url", "https://api.deepseek.com/v1", check=False)
    _hermes("config", "set", "model.api_key", os.environ.get("DEEPSEEK_API_KEY", ""), check=False)
    _hermes("config", "set", "model.default", "deepseek-chat", check=False)
    print(">>> starting `hermes gateway` in background...", flush=True)
    p = subprocess.Popen([HERMES_BIN, "gateway"], env=_env(),
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    time.sleep(45)
    for host in ("127.0.0.1", "0.0.0.0"):
        try:
            socket.create_connection((host, 8642), timeout=3).close()
            print(f">>> PORT 8642 OPEN on {host}", flush=True)
        except Exception as e:
            print(f">>> PORT 8642 CLOSED on {host}: {e}", flush=True)
    key = os.environ.get("API_SERVER_KEY", "")
    subprocess.run(["bash", "-c", f"curl -s -m 80 -X POST -H 'Authorization: Bearer {key}' -H 'Content-Type: application/json' -d '{{\"model\":\"hermes-agent\",\"messages\":[{{\"role\":\"user\",\"content\":\"say hi\"}}]}}' http://127.0.0.1:8642/v1/chat/completions; echo '<<curl done>>'"])
    p.terminate()
    try:
        out, _ = p.communicate(timeout=6)
    except Exception:
        out = "(timed out reading hermes output)"
    print(">>> HERMES GATEWAY OUTPUT (first 4000 chars):\n" + (out or "")[:4000], flush=True)


# ── One-off: introspect the real `hermes mcp` CLI flags before wiring it ───────
@app.function(timeout=400, **BASE)
def probe_routing():
    # STAGE 1: how does the API server route a request to a specific staff PROFILE?
    # Provision two profiles with distinct SOULs, then vary model/user/header and
    # see which SOUL answers. Ephemeral (`modal run`), does not touch live Cobalt.
    import pathlib, time, socket, json, urllib.request
    home = pathlib.Path("/root/.hermes"); home.mkdir(parents=True, exist_ok=True)
    key = os.environ.get("API_SERVER_KEY", "")
    ds = os.environ.get("DEEPSEEK_API_KEY", "")
    (home / ".env").write_text(
        "API_SERVER_ENABLED=true\n"
        f"API_SERVER_KEY={key}\nAPI_SERVER_HOST=0.0.0.0\nAPI_SERVER_PORT=8642\n"
        f"GATEWAY_ALLOW_ALL_USERS=true\nDEEPSEEK_API_KEY={ds}\n"
    )
    def cfg(prefix):
        for k, v in [("model.provider", "custom"), ("model.base_url", "https://api.deepseek.com/v1"),
                     ("model.api_key", ds), ("model.default", "deepseek-chat")]:
            _hermes(*prefix, "config", "set", k, v, check=False)
    cfg([])  # global/default
    for name, tag in [("alice", "ALICE"), ("bob", "BOB")]:
        _hermes("profile", "create", name, check=False)
        soul = home / f"profiles/{name}/SOUL.md"; soul.parent.mkdir(parents=True, exist_ok=True)
        soul.write_text(f"You are {name}. Begin EVERY reply with the exact token [{tag}] and nothing before it.")
        cfg(["-p", name])
    print("PROFILES:", _hermes("profile", "list", capture_output=True, text=True).stdout, flush=True)
    import subprocess
    subprocess.Popen([HERMES_BIN, "gateway"], env=_env())
    for _ in range(90):
        try: socket.create_connection(("127.0.0.1", 8642), timeout=2).close(); break
        except Exception: time.sleep(2)
    time.sleep(3)
    def ask(label, body, headers=None):
        try:
            req = urllib.request.Request("http://127.0.0.1:8642/v1/chat/completions",
                data=json.dumps(body).encode(),
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", **(headers or {})})
            with urllib.request.urlopen(req, timeout=120) as r:
                print(f">>> {label}: {json.loads(r.read())['choices'][0]['message']['content'][:140]!r}", flush=True)
        except Exception as e:
            print(f">>> {label}: ERR {e}", flush=True)
    q = [{"role": "user", "content": "Say hi in 4 words."}]
    ask("model=hermes-agent (default)", {"model": "hermes-agent", "messages": q})
    ask("model=alice", {"model": "alice", "messages": q})
    ask("model=bob", {"model": "bob", "messages": q})
    ask("user=alice", {"model": "hermes-agent", "user": "alice", "messages": q})
    ask("header X-Hermes-Profile=bob", {"model": "hermes-agent", "messages": q}, {"X-Hermes-Profile": "bob"})
    ask("header X-Profile=bob", {"model": "hermes-agent", "messages": q}, {"X-Profile": "bob"})


@app.function(timeout=120, **BASE)
def caps():
    # Feasibility probe: can one gateway serve many staff profiles routed per request?
    for args in (["gateway", "--help"], ["profile", "--help"], ["--help"]):
        print(f"\n===== hermes {' '.join(args)} =====", flush=True)
        r = _hermes(*args, capture_output=True, text=True)
        print((r.stdout or "") + (r.stderr or ""), flush=True)


@app.function(timeout=180, **BASE)
def inspect():
    import sys
    api_base = os.environ.get("WORKDAEMON_API_BASE", "")
    brain_token = os.environ.get("BRAIN_MCP_TOKEN", "")
    print(f">>> api_base set={bool(api_base)} token_len={len(brain_token)}", flush=True)
    _hermes("mcp", "remove", "brain", check=False)
    r = _hermes(
        "mcp", "--accept-hooks", "add", "brain",
        "--command", sys.executable, "--args", "/root/hermes/brain_mcp.py",
        "--env", f"WORKDAEMON_API_BASE={api_base}", f"BRAIN_MCP_TOKEN={brain_token}",
        input="y\n", text=True, capture_output=True,
    )
    print("=== add stdout/err ===\n" + (r.stdout or "") + (r.stderr or ""), flush=True)
    # GitHub MCP (needs a token to discover tools)
    gh_token = os.environ.get("GITHUB_PERSONAL_ACCESS_TOKEN", "")
    print(f">>> node: {_hermes('--version', check=False) and ''}", flush=True)
    nv = subprocess.run(["node", "--version"], capture_output=True, text=True)
    print(">>> node --version:", (nv.stdout or nv.stderr).strip(), flush=True)
    print(f">>> github token_len={len(gh_token)}", flush=True)
    if gh_token:
        _hermes("mcp", "remove", "github", check=False)
        g = _hermes(
            "mcp", "--accept-hooks", "add", "github",
            "--command", "npx", "--args", "-y", "@modelcontextprotocol/server-github",
            "--env", f"GITHUB_PERSONAL_ACCESS_TOKEN={gh_token}",
            input="y\n", text=True, capture_output=True,
        )
        print("=== github add stdout/err ===\n" + (g.stdout or "") + (g.stderr or ""), flush=True)
    lst = _hermes("mcp", "list", capture_output=True, text=True)
    print("=== mcp list ===\n" + (lst.stdout or "") + (lst.stderr or ""), flush=True)


# ── Gateway: OpenAI-compatible API server on :8642 ────────────────────────────
@app.function(timeout=60 * 60, min_containers=GATEWAY_MIN, **BASE)  # 0=$0 idle; set HERMES_MIN_CONTAINERS=1 for a warm shared gateway
@modal.web_server(8642, startup_timeout=300)
def gateway():
    import pathlib
    home = pathlib.Path("/root/.hermes")
    home.mkdir(parents=True, exist_ok=True)
    # API server settings go in ~/.hermes/.env (config.yaml not supported for these).
    (home / ".env").write_text(
        "API_SERVER_ENABLED=true\n"
        f"API_SERVER_KEY={os.environ.get('API_SERVER_KEY', '')}\n"
        "API_SERVER_HOST=0.0.0.0\n"
        "API_SERVER_PORT=8642\n"
        "GATEWAY_ALLOW_ALL_USERS=true\n"
        f"DEEPSEEK_API_KEY={os.environ.get('DEEPSEEK_API_KEY', '')}\n"
    )
    # Hermes's built-in "deepseek" provider routes via OpenRouter (needs an OR key);
    # use the `custom` provider pointed straight at DeepSeek's native OpenAI API.
    _hermes("config", "set", "model.provider", "custom", check=False)
    _hermes("config", "set", "model.base_url", "https://api.deepseek.com/v1", check=False)
    _hermes("config", "set", "model.api_key", os.environ.get("DEEPSEEK_API_KEY", ""), check=False)
    _hermes("config", "set", "model.default", "deepseek-chat", check=False)
    # ── Company-Brain MCP tool ────────────────────────────────────────────────
    # Run brain_mcp.py as a LOCAL stdio subprocess (not internet-exposed). The
    # token is passed only to that subprocess and the API binds it to one
    # workspace, so the agent can PULL company truth (context/hunt/search) but
    # nothing outside can. Re-add is idempotent across container restarts.
    import sys
    api_base = os.environ.get("WORKDAEMON_API_BASE", "")
    brain_token = os.environ.get("BRAIN_MCP_TOKEN", "")
    if api_base:
        # Two auth modes (see brain_mcp.py): a static BRAIN_MCP_TOKEN binds a
        # DEDICATED gateway to one workspace; on the SHARED gateway there is no
        # env token — each agent passes the short-lived signed token the proxy
        # put in its system message as the tools' access_token parameter, and
        # the API binds the workspace from the token's signature.
        _hermes("mcp", "remove", "brain", check=False)
        # `mcp add` discovers the tools then asks "Enable all N tools? [Y/n/select]"
        # on a TTY — with no TTY it cancels and saves nothing. Feed "y" so all three
        # brain tools are enabled non-interactively.
        env_args = [f"WORKDAEMON_API_BASE={api_base}"]
        if brain_token:
            env_args.append(f"BRAIN_MCP_TOKEN={brain_token}")
        _hermes(
            "mcp", "--accept-hooks", "add", "brain",
            "--command", sys.executable,
            "--args", "/root/hermes/brain_mcp.py",
            "--env", *env_args,
            input="y\n", text=True, check=False,
        )
        print(">>> brain MCP wired (stdio, %s):" % ("dedicated token" if brain_token else "per-turn signed tokens"),
              _hermes("mcp", "list", capture_output=True, text=True).stdout, flush=True)
    else:
        print(">>> brain MCP NOT wired (WORKDAEMON_API_BASE unset)", flush=True)
    # ── GitHub MCP tool ───────────────────────────────────────────────────────
    # The agent acts on GitHub itself (list/read/search + create issues/PRs within
    # the token's scope) via the npx GitHub MCP server as a local stdio subprocess.
    # In production this token is the workspace's per-user GitHub OAuth grant; here
    # it comes from the hermes-<company> secret. Inert if unset.
    gh_token = os.environ.get("GITHUB_PERSONAL_ACCESS_TOKEN", "")
    if gh_token:
        _hermes("mcp", "remove", "github", check=False)
        _hermes(
            "mcp", "--accept-hooks", "add", "github",
            "--command", "npx", "--args", "-y", "@modelcontextprotocol/server-github",
            "--env", f"GITHUB_PERSONAL_ACCESS_TOKEN={gh_token}",
            input="y\n", text=True, check=False,
        )
        print(">>> github MCP wired (stdio):", _hermes("mcp", "list", capture_output=True, text=True).stdout, flush=True)
    else:
        print(">>> github MCP NOT wired (GITHUB_PERSONAL_ACCESS_TOKEN unset)", flush=True)
    # CRITICAL: @modal.web_server wants the function to LAUNCH the server (Popen)
    # and RETURN — Modal then keeps the container alive and proxies to :8642.
    # Blocking here (serve_forever / subprocess.run) makes Modal think startup
    # never finished, so it never routes. So: Popen + return.
    subprocess.Popen([HERMES_BIN, "gateway"], env=_env())


# ── Profile + tool ops (stages 3-4; ephemeral home for now) ───────────────────
def _provision(staff_id, soul_md, provider, model):
    import pathlib
    _hermes("profile", "create", staff_id, check=False)
    soul = pathlib.Path(f"/root/.hermes/profiles/{staff_id}/SOUL.md")
    soul.parent.mkdir(parents=True, exist_ok=True)
    soul.write_text(soul_md or "You are a WorkDaemon daemon. Follow the system message exactly.")
    for k, v in [("model.provider", provider), ("model.default", model)]:
        _hermes("-p", staff_id, "config", "set", k, v, check=False)
    return {"ok": True, "profile": staff_id}


def _connect(name, command=None, args=None, url=None, auth=None, env=None):
    # Add to the GLOBAL config — the gateway serves the default agent, so a tool
    # must be in the global config to actually reach the running gateway. (Per-
    # profile `-p` wiring waits until the gateway routes per staff profile.)
    # `--env` carries the connecting user's OAuth token to the stdio MCP server;
    # feed "y" so the "Enable all N tools?" prompt doesn't cancel headless.
    cmd = ["mcp", "--accept-hooks", "add", name]
    if url:
        cmd += ["--url", url]
    if command:
        cmd += ["--command", command]
    if args:
        cmd += ["--args", *args]
    if env:
        cmd += ["--env", *[f"{k}={v}" for k, v in env.items()]]
    if auth:
        cmd += ["--auth", auth]
    _hermes("mcp", "remove", name, check=False)
    _hermes(*cmd, input="y\n", text=True, check=False)
    return {"ok": True, "tool": name}


# ── Admin HTTP endpoint — stages 3 + 4 (stdlib, threaded) ─────────────────────
@app.function(timeout=60 * 60, min_containers=0, **BASE)
@modal.web_server(8643, startup_timeout=120)
def admin():
    import json
    import http.server

    class Handler(http.server.BaseHTTPRequestHandler):
        def _send(self, obj, code=200):
            body = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            self._send({"ok": True, "service": "workdaemon-hermes-admin"})

        def do_POST(self):
            try:
                n = int(self.headers.get("content-length", 0))
                payload = json.loads(self.rfile.read(n) or b"{}")
            except Exception as e:
                return self._send({"ok": False, "error": f"bad json: {e}"}, 400)
            if payload.get("token") != os.environ.get("HERMES_ADMIN_TOKEN"):
                return self._send({"ok": False, "error": "unauthorized"}, 401)
            try:
                if payload.get("action") == "provision":
                    r = _provision(payload["staff_id"], payload.get("soul_md", ""), payload["provider"], payload["model"])
                elif payload.get("action") == "connect":
                    r = _connect(payload["name"], payload.get("command"), payload.get("args"), payload.get("url"), payload.get("auth"), payload.get("env"))
                else:
                    r = {"ok": False, "error": "unknown action"}
            except Exception as e:
                r = {"ok": False, "error": str(e)}
            self._send(r)

        def log_message(self, *a):
            pass

    # Start in a thread and RETURN (Modal keeps the container + proxies); blocking
    # here would make Modal never mark the server ready.
    import threading
    httpd = http.server.ThreadingHTTPServer(("0.0.0.0", 8643), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
