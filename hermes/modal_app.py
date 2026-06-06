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
# fastapi is needed for the admin HTTP endpoint WorkDaemon calls.
image = modal.Image.from_registry("nousresearch/hermes-agent", add_python="3.11").pip_install("fastapi[standard]")

# Persistent per-company profile store (Hermes' ~/.hermes → /opt/data).
volume = modal.Volume.from_name(f"hermes-{COMPANY}", create_if_missing=True)
# API_SERVER_KEY + the company's cloud model provider key(s).
secret = modal.Secret.from_name(f"hermes-{COMPANY}")

DATA = "/opt/data"
BASE = dict(image=image, volumes={DATA: volume}, secrets=[secret])


# ── The always-on gateway: OpenAI-compatible API server on :8642 ──────────────
@app.function(timeout=60 * 60, min_containers=1, **BASE)
@modal.web_server(8642, startup_timeout=240)
def gateway():
    # API_SERVER_KEY is provided by the Modal secret; the server reads it.
    os.environ["API_SERVER_ENABLED"] = "true"
    os.environ.setdefault("HERMES_HOME", DATA)
    # The OpenAI-compatible endpoint routes a request to the profile named in the
    # request's `model` field (WorkDaemon passes model='<staff_id>').
    subprocess.Popen(["hermes", "gateway", "run"])


# ── Profile + tool ops (shared by the admin endpoint and `modal run`) ─────────
def _provision(staff_id: str, soul_md: str, provider: str, model: str):
    """Create a per-staff Hermes profile: SOUL.md + cloud model + API server on."""
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
# POST { token, action: 'provision'|'connect', ... }. Token = HERMES_ADMIN_TOKEN
# (in the Modal secret). Put this endpoint's URL + the token on the workspace's
# Hermes integration row so api/_lib/hermes_admin.js can reach it.
@app.function(**BASE)
@modal.fastapi_endpoint(method="POST")
def admin(payload: dict):
    if not payload or payload.get("token") != os.environ.get("HERMES_ADMIN_TOKEN"):
        return {"ok": False, "error": "unauthorized"}
    action = payload.get("action")
    if action == "provision":
        return _provision(payload["staff_id"], payload.get("soul_md", ""),
                          payload["provider"], payload["model"])
    if action == "connect":
        return _connect(payload["staff_id"], payload["name"], payload.get("command"),
                       payload.get("args"), payload.get("url"), payload.get("auth", "oauth"))
    return {"ok": False, "error": f"unknown action: {action}"}
