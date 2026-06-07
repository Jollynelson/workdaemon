"""
WorkDaemon × Hermes Agent runtime on Modal  (FINAL BuildSpec — Hermes layer).

Runs the official Hermes Agent image as an OpenAI-compatible gateway (:8642) that
WorkDaemon's `hermes` chat provider (api/chat.js) proxies to. Each staff member is
a Hermes PROFILE with its own SOUL.md, model, memory, and MCP tools; the agent
does its own tool-calling with Hermes' native approval gate — no executors.

ONE app per company so each company's ~/.hermes profile store is isolated on its
own Modal Volume. Set the company via HERMES_COMPANY at deploy time.

DEPLOY (you run this — needs a Modal account; not verifiable from WorkDaemon CI):
    modal secret create hermes-<company> \
        API_SERVER_KEY=<random-secret> \
        ANTHROPIC_API_KEY=<...>            # or whichever cloud model provider (no GPU)
    HERMES_COMPANY=<company> modal deploy hermes/modal_app.py
The deploy prints the gateway web URL. Put it on the workspace:
    workspace_api_keys: provider='hermes', endpoint=<url>, api_key=<API_SERVER_KEY>,
                        model='<staff_id>'   # selects the profile
Then provision each staff member + connect tools (functions below).

Verify exact Modal + Hermes flags against current docs at deploy time; this is the
deployable runtime definition, not a live-verified deployment.
"""
import os
import subprocess
import pathlib

import modal

COMPANY = os.environ.get("HERMES_COMPANY", "default")

app = modal.App(f"workdaemon-hermes-{COMPANY}")

# Official Hermes Agent image — ships the gateway / OpenAI-compatible API server.
# The admin endpoint uses only Python stdlib (the Hermes image's venv has no pip).
# /opt/data is non-empty in the image, but a Modal Volume can only mount on an
# EMPTY path — so stash the image's defaults to /opt/data-seed and empty /opt/data;
# _ensure_data() seeds the volume from it on first boot.
image = (
    modal.Image.from_registry("nousresearch/hermes-agent", add_python="3.11")
    # The image's ENTRYPOINT is s6-overlay's /init, which requires PID 1; Modal
    # runs our function instead, so clear it (we launch `hermes gateway run`).
    .entrypoint([])
    # Run as root so Hermes can write to the volume-mounted data dir (logs, profiles).
    .dockerfile_commands(["USER root"])
    .run_commands(
        "mkdir -p /opt/data-seed && cp -a /opt/data/. /opt/data-seed/ 2>/dev/null || true",
        "rm -rf /opt/data && mkdir -p /opt/data",
    )
)

# Persistent per-company profile store (Hermes' ~/.hermes → /opt/data).
volume = modal.Volume.from_name(f"hermes-{COMPANY}", create_if_missing=True)
# API_SERVER_KEY + the company's cloud model provider key(s).
secret = modal.Secret.from_name(f"hermes-{COMPANY}")

DATA = "/opt/data"
BASE = dict(image=image, volumes={DATA: volume}, secrets=[secret], memory=2048)


def _ensure_data():
    """Seed the (initially empty) Volume from the image's stashed defaults once."""
    import shutil
    if os.path.isdir(DATA) and not os.listdir(DATA) and os.path.isdir("/opt/data-seed"):
        for item in os.listdir("/opt/data-seed"):
            s, d = f"/opt/data-seed/{item}", f"{DATA}/{item}"
            if os.path.isdir(s):
                shutil.copytree(s, d, dirs_exist_ok=True)
            else:
                shutil.copy2(s, d)
        volume.commit()


# ── The always-on gateway: OpenAI-compatible API server on :8642 ──────────────
# Plain image: only clear the s6 entrypoint. Do NOT empty /opt/data or force USER
# root — Hermes runs as its own user and writes to its built-in home; let it.
image_plain = modal.Image.from_registry("nousresearch/hermes-agent", add_python="3.11").entrypoint([])


@app.function(timeout=60 * 60, min_containers=1, image=image_plain, secrets=[secret], memory=2048)
@modal.web_server(8642, startup_timeout=300)
def gateway():
    # Use the image's default HERMES_HOME (owned + writable by the hermes user).
    subprocess.run(["hermes", "profile", "create", "default"], check=False)
    subprocess.run(["hermes", "-p", "default", "config", "set", "model.provider", "deepseek"], check=False)
    subprocess.run(["hermes", "-p", "default", "config", "set", "model.default", "deepseek-chat"], check=False)
    os.environ["API_SERVER_ENABLED"] = "true"
    subprocess.run(["hermes", "gateway", "run"])


# ── Profile + tool ops (shared by the admin endpoint and `modal run`) ─────────
def _provision(staff_id: str, soul_md: str, provider: str, model: str):
    """Create a per-staff Hermes profile: SOUL.md + cloud model + API server on."""
    _ensure_data()
    os.environ.setdefault("HERMES_HOME", DATA)
    subprocess.run(["hermes", "profile", "create", staff_id], check=False)
    soul = pathlib.Path(f"{DATA}/profiles/{staff_id}/SOUL.md")
    soul.parent.mkdir(parents=True, exist_ok=True)
    soul.write_text(soul_md or "You are a WorkDaemon daemon. Follow the system message exactly.")
    for k, v in [("model.provider", provider), ("model.default", model),
                 ("API_SERVER_ENABLED", "true"), ("reasoning_effort", "low")]:
        subprocess.run(["hermes", "-p", staff_id, "config", "set", k, v], check=False)
    volume.commit()
    return {"ok": True, "profile": staff_id}


def _connect(staff_id: str, name: str, command=None, args=None, url=None, auth="oauth"):
    """`hermes -p <staff> mcp add <tool>` — the agent then acts on it itself."""
    _ensure_data()
    os.environ.setdefault("HERMES_HOME", DATA)
    cmd = ["hermes", "-p", staff_id, "mcp", "add", name]
    if url:
        cmd += ["--url", url]
    if command:
        cmd += ["--command", command]
    if args:
        cmd += ["--args", *args]
    cmd += ["--auth", auth]
    subprocess.run(cmd, check=False)
    volume.commit()
    return {"ok": True, "tool": name}


# CLI-callable wrappers (`modal run hermes/modal_app.py::provision_staff ...`).
@app.function(**BASE)
def provision_staff(staff_id: str, soul_md: str, provider: str, model: str):
    return _provision(staff_id, soul_md, provider, model)


@app.function(**BASE)
def connect_tool(staff_id: str, name: str, command: str = None,
                 args: list = None, url: str = None, auth: str = "oauth"):
    return _connect(staff_id, name, command, args, url, auth)


# ── Admin HTTP endpoint — what WorkDaemon calls (stages 3 + 4) ────────────────
# A tiny stdlib HTTP server on :8643 (no deps; the Hermes image venv has no pip).
# POST { token, action: 'provision'|'connect', ... }. Token = HERMES_ADMIN_TOKEN
# (in the Modal secret). Put this endpoint's URL + the token on the workspace's
# Hermes integration row so api/_lib/hermes_admin.js can reach it.
@app.function(timeout=60 * 60, min_containers=1, **BASE)
@modal.web_server(8643, startup_timeout=240)
def admin():
    print("admin: booting", flush=True)
    _ensure_data()
    print("admin: data ready; starting http server on :8643", flush=True)
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

        def do_GET(self):  # health check
            self._send({"ok": True, "service": "workdaemon-hermes-admin"})

        def do_POST(self):
            try:
                n = int(self.headers.get("content-length", 0))
                payload = json.loads(self.rfile.read(n) or b"{}")
            except Exception as e:
                return self._send({"ok": False, "error": f"bad json: {e}"}, 400)
            if payload.get("token") != os.environ.get("HERMES_ADMIN_TOKEN"):
                return self._send({"ok": False, "error": "unauthorized"}, 401)
            action = payload.get("action")
            try:
                if action == "provision":
                    r = _provision(payload["staff_id"], payload.get("soul_md", ""),
                                   payload["provider"], payload["model"])
                elif action == "connect":
                    r = _connect(payload["staff_id"], payload["name"], payload.get("command"),
                                 payload.get("args"), payload.get("url"), payload.get("auth", "oauth"))
                else:
                    r = {"ok": False, "error": f"unknown action: {action}"}
            except Exception as e:
                r = {"ok": False, "error": str(e)}
            self._send(r)

        def log_message(self, *a):
            pass

    # Threaded so Modal's readiness probe + real requests are handled concurrently.
    import threading, socket, time
    httpd = http.server.ThreadingHTTPServer(("0.0.0.0", 8643), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    time.sleep(1)
    try:
        socket.create_connection(("127.0.0.1", 8643), timeout=3).close()
        print("admin: SELF-CONNECT OK on 8643", flush=True)
    except Exception as e:
        print(f"admin: SELF-CONNECT FAIL: {e}", flush=True)
    while True:
        time.sleep(3600)
