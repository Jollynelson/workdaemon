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


@app.function(
    image=image,
    gpu="T4",
    timeout=60 * 5,        # 5min per request (long agentic chains)
    min_containers=0,       # scale to zero; set to 1 for active companies at startup
    volumes={"/models": model_volume},
    secrets=[modal.Secret.from_name("workdaemon-secrets")],
)
def chat_completion(
    company_id: str,
    messages: list[dict],
    system_prompt: str,
    model_version: int | None = None,
    temperature: float = 0.3,
    max_tokens: int = 2048,
) -> dict:
    """
    Run inference for a specific company's wd-{company_id} model.

    Pulls the GGUF from HF the first time; subsequent calls use the cached
    version in the Modal Volume. Returns the assistant message content
    plus any tool_call blocks the model produced.

    Returns: {"content": str, "tool_calls": list[dict], "model": str}
    """
    import subprocess
    import time

    import httpx

    from src.config import settings
    from src.model.naming import wd_model
    from src.registry.hf_registry import pull_gguf
    from src.serving.ollama_loader import load_into_ollama, is_loaded

    ollama_name = wd_model(company_id)
    gguf_cache = f"/models/{company_id}-v{model_version or 'latest'}.gguf"

    # ── 1. Start Ollama server in the container ────────────────────────────────
    subprocess.Popen(["ollama", "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2)  # give Ollama time to start

    # ── 2. Load model if not already in Ollama ────────────────────────────────
    if not is_loaded(company_id):
        import os
        if os.path.exists(gguf_cache):
            gguf_path = gguf_cache
        else:
            gguf_path = pull_gguf(company_id, model_version or _latest_version(company_id))
            # Cache for future warm containers
            import shutil
            shutil.copy(gguf_path, gguf_cache)
            model_volume.commit()

        company_name = _get_company_name(company_id)
        load_into_ollama(company_id, gguf_path, company_name)

    # ── 3. Call Ollama chat API ────────────────────────────────────────────────
    full_messages = [{"role": "system", "content": system_prompt}, *messages]
    resp = httpx.post(
        f"{settings.ollama_base_url}/api/chat",
        json={
            "model": ollama_name,
            "messages": full_messages,
            "stream": False,
            "options": {"temperature": temperature, "num_predict": max_tokens},
        },
        timeout=120.0,
    )
    resp.raise_for_status()
    data = resp.json()
    content = data["message"]["content"]

    # ── 4. Parse any <tool_call> blocks Hermes-3 emits ────────────────────────
    tool_calls = _parse_tool_calls(content)

    return {
        "content": content,
        "tool_calls": tool_calls,
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
# calls POST /api/serve/chat here. Per-company inference is routed to the GPU
# `chat_completion` function above via modal_bridge; companies without a deployed
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
    secrets=[modal.Secret.from_name("workdaemon-secrets")],
    timeout=60 * 5,
)
@modal.asgi_app()
def fastapi_app():
    # Inject the GPU serving function so router.chat serves the real per-company
    # model (modal_bridge avoids a cross-module `import modal`, which would hit
    # the local `modal/` package shadow).
    from src.serving.modal_bridge import set_gpu_serving

    set_gpu_serving(chat_completion)

    from src.api.main import app as fastapi

    return fastapi
