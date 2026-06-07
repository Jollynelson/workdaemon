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

HERMES_BIN = "/usr/local/bin/hermes"  # install.sh links it here

# Clean image: install the Hermes CLI as root. No s6, no non-root user, no /opt/data.
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("curl", "ca-certificates", "git")
    .run_commands(
        "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash",
        f"test -x {HERMES_BIN}",  # fail the build loudly if the CLI didn't land
    )
    # Company-Brain MCP tool runs as a local stdio subprocess inside the gateway
    # container — bundle it + its deps into the image.
    .pip_install("mcp[cli]", "httpx")
    .add_local_file("hermes/brain_mcp.py", "/root/hermes/brain_mcp.py")
)

secret = modal.Secret.from_name(f"hermes-{COMPANY}")
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
@app.function(image=image, secrets=[secret], memory=2048, timeout=180)
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
    lst = _hermes("mcp", "list", capture_output=True, text=True)
    print("=== mcp list ===\n" + (lst.stdout or "") + (lst.stderr or ""), flush=True)


# ── Gateway: OpenAI-compatible API server on :8642 ────────────────────────────
@app.function(timeout=60 * 60, min_containers=0, **BASE)  # scale-to-zero ($0 idle); bump to 1 for warm/no-cold-start while actively testing
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
    if api_base and brain_token:
        _hermes("mcp", "remove", "brain", check=False)
        # `mcp add` discovers the tools then asks "Enable all N tools? [Y/n/select]"
        # on a TTY — with no TTY it cancels and saves nothing. Feed "y" so all three
        # brain tools are enabled non-interactively.
        _hermes(
            "mcp", "--accept-hooks", "add", "brain",
            "--command", sys.executable,
            "--args", "/root/hermes/brain_mcp.py",
            "--env", f"WORKDAEMON_API_BASE={api_base}", f"BRAIN_MCP_TOKEN={brain_token}",
            input="y\n", text=True, check=False,
        )
        print(">>> brain MCP wired (stdio):", _hermes("mcp", "list", capture_output=True, text=True).stdout, flush=True)
    else:
        print(">>> brain MCP NOT wired (WORKDAEMON_API_BASE / BRAIN_MCP_TOKEN unset)", flush=True)
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


def _connect(staff_id, name, command=None, args=None, url=None, auth="oauth"):
    cmd = ["-p", staff_id, "mcp", "add", name]
    if url:
        cmd += ["--url", url]
    if command:
        cmd += ["--command", command]
    if args:
        cmd += ["--args", *args]
    cmd += ["--auth", auth]
    _hermes(*cmd, check=False)
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
                    r = _connect(payload["staff_id"], payload["name"], payload.get("command"), payload.get("args"), payload.get("url"), payload.get("auth", "oauth"))
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
