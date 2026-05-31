"""
Modal GPU serving endpoint — on-demand inference for per-company wd-{company_id} models.

Architecture:
  - One Modal Function per serve request; Modal manages GPU lifecycle.
  - Warm pool during business hours (keep_warm=1 per active company).
  - Scale to zero off-hours to save cost.
  - Cold-start gap is covered by the Claude fallback in router.py — the user
    never waits 60s for a first token.

Usage (from router.py):
    from modal.serve_app import chat_completion
    result = chat_completion.remote(company_id=..., messages=..., system_prompt=...)
"""

from __future__ import annotations

import os

import modal

# ── Image ─────────────────────────────────────────────────────────────────────
# Ollama is installed via the official install script inside the container.
# vLLM is an alternative for higher-throughput deployments.

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("curl", "git", "zstd")  # zstd: required by the Ollama installer
    .run_commands(
        # Install Ollama (includes the binary + service setup)
        "curl -fsSL https://ollama.com/install.sh | sh",
    )
    .pip_install(
        "httpx>=0.27.0",
        "huggingface_hub>=0.22.0",
        "pydantic-settings>=2.2.0",
        "python-dotenv>=1.0.0",
        "supabase>=2.4.0",   # _latest_version / _get_company_name query Supabase
    )
    .add_local_python_source("src")
)

app = modal.App("workdaemon-serving")

# Persistent volume for Ollama model storage (survives container restarts)
model_volume = modal.Volume.from_name("workdaemon-models", create_if_missing=True)


def _ollama_up(base_url: str) -> bool:
    import httpx
    try:
        httpx.get(f"{base_url}/api/tags", timeout=2.0)
        return True
    except Exception:
        return False


def _ensure_ollama(base_url: str) -> None:
    """Start Ollama if it isn't already running (no-op on a warm container)."""
    import subprocess
    import time
    if _ollama_up(base_url):
        return
    subprocess.Popen(["ollama", "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(60):
        if _ollama_up(base_url):
            return
        time.sleep(1)


def _ensure_model_loaded(company_id: str, model_version: int | None) -> None:
    """Load a company's GGUF into Ollama if not already loaded (cached in Volume)."""
    import os
    import shutil

    from src.registry.hf_registry import pull_gguf
    from src.serving.ollama_loader import is_loaded, load_into_ollama

    if is_loaded(company_id):
        return
    gguf_cache = f"/models/{company_id}-v{model_version or 'latest'}.gguf"
    if os.path.exists(gguf_cache):
        gguf_path = gguf_cache
    else:
        gguf_path = pull_gguf(company_id, model_version or _latest_version(company_id))
        shutil.copy(gguf_path, gguf_cache)
        model_volume.commit()
    load_into_ollama(company_id, gguf_path, _get_company_name(company_id))


def _warm_inference(company_id: str) -> None:
    """Pull a loaded model into VRAM and pin it (1-token generate, keep_alive=-1)."""
    import httpx

    from src.config import settings
    from src.model.naming import wd_model
    httpx.post(
        f"{settings.ollama_base_url}/api/generate",
        json={
            "model": wd_model(company_id),
            "prompt": "ok",
            "stream": False,
            "keep_alive": -1,
            "options": {"num_predict": 1},
        },
        timeout=120.0,
    )


def _deployed_companies(limit: int = 4) -> list[tuple[str, int]]:
    """Most-recently-trained deployed companies, deduped by company_id."""
    from supabase import create_client

    from src.config import settings
    client = create_client(settings.supabase_url, settings.supabase_service_key)
    resp = (
        client.table("model_versions")
        .select("company_id,version")
        .eq("deployed", True)
        .order("trained_at", desc=True)
        .limit(limit * 4)
        .execute()
    )
    out: list[tuple[str, int]] = []
    seen: set[str] = set()
    for row in resp.data or []:
        cid = row["company_id"]
        if cid not in seen:
            seen.add(cid)
            out.append((cid, row["version"]))
        if len(out) >= limit:
            break
    return out


@app.cls(
    image=image,
    gpu="T4",
    timeout=60 * 5,        # 5min per request (long agentic chains)
    min_containers=1,       # warm pool: keep one GPU container hot. NOTE: a warm
                            # T4 bills 24/7 — drop to 0 (relies on scaledown_window)
                            # or run a business-hours schedule to cut idle cost.
    scaledown_window=600,   # if min_containers is set to 0, stay warm 10min idle
    volumes={"/models": model_volume},
    secrets=[modal.Secret.from_name("workdaemon-secrets")],
)
class HermesServer:
    """Warm GPU inference server. Ollama starts and the most-recent company
    models preload at container startup (@enter), so the first request finds the
    model already resident — no per-request cold start, no Modal 303 redirect."""

    @modal.enter()
    def _startup(self) -> None:
        import logging

        from src.config import settings
        log = logging.getLogger("HermesServer")
        _ensure_ollama(settings.ollama_base_url)
        limit = int(os.environ.get("WARM_PRELOAD_LIMIT", "4"))
        try:
            for cid, ver in _deployed_companies(limit=limit):
                try:
                    _ensure_model_loaded(cid, ver)
                    _warm_inference(cid)  # into VRAM + pinned
                    log.info("preloaded model company=%s v%s", cid, ver)
                except Exception as exc:
                    log.warning("preload failed company=%s: %s", cid, exc)
        except Exception as exc:
            log.warning("preload listing failed: %s", exc)

    @modal.method()
    def chat_completion(
        self,
        company_id: str,
        messages: list[dict],
        system_prompt: str,
        model_version: int | None = None,
        temperature: float = 0.3,
        max_tokens: int = 2048,
    ) -> dict:
        """Run inference for a company's wd-{company_id} model.

        Returns: {"content": str, "tool_calls": list[dict], "model": str}
        """
        import httpx

        from src.config import settings
        from src.model.naming import wd_model

        _ensure_ollama(settings.ollama_base_url)
        _ensure_model_loaded(company_id, model_version)  # no-op if preloaded

        ollama_name = wd_model(company_id)
        full_messages = [{"role": "system", "content": system_prompt}, *messages]
        resp = httpx.post(
            f"{settings.ollama_base_url}/api/chat",
            json={
                "model": ollama_name,
                "messages": full_messages,
                "stream": False,
                "keep_alive": -1,  # pin in VRAM (no idle eviction → no reload latency)
                "options": {"temperature": temperature, "num_predict": max_tokens},
            },
            timeout=120.0,
        )
        resp.raise_for_status()
        content = resp.json()["message"]["content"]
        return {
            "content": content,
            "tool_calls": _parse_tool_calls(content),
            "model": ollama_name,
        }


def _parse_tool_calls(content: str) -> list[dict]:
    """Extract <tool_call>{...}</tool_call> blocks from Hermes-3 output."""
    import json
    import re
    tool_calls = []
    for match in re.finditer(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", content, re.DOTALL):
        try:
            tool_calls.append(json.loads(match.group(1)))
        except json.JSONDecodeError:
            pass
    return tool_calls


def _get_company_name(company_id: str) -> str:
    from supabase import create_client
    from src.config import settings
    client = create_client(settings.supabase_url, settings.supabase_service_key)
    resp = client.table("companies").select("name").eq("id", company_id).single().execute()
    return resp.data["name"] if resp.data else company_id


def _latest_version(company_id: str) -> int:
    from supabase import create_client
    from src.config import settings
    client = create_client(settings.supabase_url, settings.supabase_service_key)
    resp = (
        client.table("model_versions")
        .select("version")
        .eq("company_id", company_id)
        .eq("deployed", True)
        .order("version", desc=True)
        .limit(1)
        .execute()
    )
    return resp.data[0]["version"] if resp.data else 1


# ── Web endpoint ────────────────────────────────────────────────────────────────
# Internet-reachable FastAPI app (CPU, scale-to-zero). The WorkDaemon Node app
# calls POST /api/serve/chat here. Per-company inference is routed to the warm
# HermesServer GPU class above via modal_bridge; companies without a deployed
# adapter (or on GPU error) fall back to Claude inside router.chat.

web_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "fastapi>=0.111.0",
        "uvicorn>=0.29.0",
        "supabase>=2.4.0",
        "anthropic>=0.25.0",
        "httpx>=0.27.0",
        "pydantic>=2.7.0",
        "pydantic-settings>=2.2.0",
        "python-dotenv>=1.0.0",
        "huggingface_hub>=0.22.0",
    )
    .add_local_python_source("src")
)


@app.function(
    image=web_image,
    # workdaemon-secrets: Supabase/HF/etc.  workdaemon-serve-secret: SERVE_MASTER_SECRET
    # (+ optional ANTHROPIC_API_KEY for the Claude fallback).
    secrets=[
        modal.Secret.from_name("workdaemon-secrets"),
        modal.Secret.from_name("workdaemon-serve-secret"),
    ],
    timeout=60 * 5,
)
@modal.asgi_app()
def fastapi_app():
    # Inject the GPU serving function so router.chat serves the real per-company
    # model (modal_bridge avoids a cross-module `import modal`, which would hit
    # the local `modal/` package shadow).
    from src.serving.modal_bridge import set_gpu_serving

    # Bind the warm GPU class method; router.chat calls .remote() on it.
    set_gpu_serving(HermesServer().chat_completion)

    from src.api.main import app as fastapi

    return fastapi
