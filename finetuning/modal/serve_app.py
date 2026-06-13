"""
Modal GPU serving — vLLM multi-LoRA inference for per-company wd-{company_id} models.

Path B (MULTI_LORA_PLAN): ONE base (Qwen3-32B) resident in VRAM + per-company LoRA
adapters hot-swapped per request via vLLM `LoRARequest`. One GPU serves many
companies; each still gets its own brain. Adapters are pulled from each company's
private HF repo (resolved via model_versions → hf_revision) and cached on a Volume.

  - Base loaded once at container @enter; adapters loaded lazily per request + cached.
  - Scale to zero off-hours; cold-start (base load) is covered by the Claude
    fallback in router.py — the user never waits.
  - Contract unchanged: chat_completion(company_id, messages, system_prompt, ...).

Usage (from router.py via modal_bridge): chat_completion.remote(...).
"""

from __future__ import annotations

import os

import modal

# fp16 base — the LoRA was QLoRA-trained against Qwen3-32B; serve on the fp16 model
# (A100-80GB). Override with SERVE_BASE_MODEL.
BASE_MODEL = os.environ.get("SERVE_BASE_MODEL", "Qwen/Qwen3-32B")
MAX_LORA_RANK = 16  # == HYPERPARAMS["lora_r"]; raise if the trained rank grows.

# Volumes so the ~64GB base + per-company adapters persist across cold starts.
hf_cache = modal.Volume.from_name("workdaemon-hf-cache", create_if_missing=True)
adapter_cache = modal.Volume.from_name("workdaemon-adapters", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "vllm",                      # multi-LoRA serving (Qwen3-capable build)
        "huggingface_hub>=0.22.0",
        "supabase>=2.4.0",
        "pydantic-settings>=2.2.0",
        "python-dotenv>=1.0.0",
        "httpx>=0.27.0",
    )
    .env({"HF_HOME": "/hf", "VLLM_USE_V1": "1"})
    .add_local_python_source("src")
)

app = modal.App("workdaemon-serving")


def _adapter_for_company(company_id: str, model_version: int | None = None) -> str | None:
    """Resolve + cache the deployed LoRA adapter directory for a company. Returns
    the local path, or None when there's no deployed model (caller falls back)."""
    import shutil

    from supabase import create_client

    from src.config import settings
    from src.registry.hf_registry import pull

    client = create_client(settings.supabase_url, settings.supabase_service_key)
    q = (
        client.table("model_versions")
        .select("version, hf_revision")
        .eq("company_id", company_id).eq("deployed", True)
        .order("version", desc=True).limit(1).execute()
    )
    if not q.data:
        return None
    rev = q.data[0]["hf_revision"]
    cache_dir = f"/adapters/{company_id}-{(rev or 'latest')[:12]}"
    if os.path.exists(os.path.join(cache_dir, "adapter_config.json")):
        return cache_dir
    local = pull(company_id, rev)  # downloads the adapter (safetensors), skips GGUF
    os.makedirs(cache_dir, exist_ok=True)
    shutil.copytree(local, cache_dir, dirs_exist_ok=True)
    adapter_cache.commit()
    return cache_dir


def _lora_int_id(company_id: str) -> int:
    """Stable positive int id vLLM needs per adapter."""
    import hashlib
    return int(hashlib.sha1(company_id.encode()).hexdigest()[:8], 16)


@app.cls(
    image=image,
    gpu="A100-80GB",          # Qwen3-32B fp16 (~64GB) + KV + LoRA; the reliable vLLM path
    timeout=60 * 10,
    min_containers=0,          # scale to ZERO when idle — no GPU bill with no traffic.
    scaledown_window=600,      # stay warm 10 min after the last request
    max_containers=2,
    volumes={"/hf": hf_cache, "/adapters": adapter_cache},
    secrets=[modal.Secret.from_name("workdaemon-secrets")],
)
class HermesServer:
    """vLLM server: one base resident + per-company LoRA per request. The first
    cold start downloads/loads the 32B base (slow, cached on the Volume after);
    the Claude fallback in router.chat covers that gap."""

    @modal.enter()
    def _startup(self) -> None:
        import logging

        from vllm import LLM
        log = logging.getLogger("HermesServer")
        log.info("loading vLLM base=%s (enable_lora, rank<=%d) ...", BASE_MODEL, MAX_LORA_RANK)
        self.llm = LLM(
            model=BASE_MODEL,
            enable_lora=True,
            max_loras=4,
            max_lora_rank=MAX_LORA_RANK,
            max_model_len=8192,
            gpu_memory_utilization=0.92,
            enforce_eager=True,        # skip CUDA-graph compile — faster start, less VRAM
            dtype="bfloat16",
            trust_remote_code=True,
        )
        log.info("vLLM base loaded; ready to serve adapters.")

    @modal.method()
    def warm(self, company_id: str, model_version: int | None = None) -> dict:
        """Pre-pull the company's adapter + record the readiness heartbeat. The base
        is already resident from @enter, so this just primes the adapter cache."""
        from src.serving.warm_state import mark_warm
        _adapter_for_company(company_id, model_version)
        mark_warm(company_id)
        return {"warmed": True, "company_id": company_id}

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
        """One chat turn through the company's LoRA on the shared base.
        Returns: {"content": str, "tool_calls": list[dict], "model": str}"""
        from vllm import SamplingParams
        from vllm.lora.request import LoRARequest

        adapter_dir = _adapter_for_company(company_id, model_version)
        if not adapter_dir:
            raise RuntimeError(f"no deployed adapter for company {company_id}")

        conversation = [{"role": "system", "content": system_prompt}, *messages]
        sampling = SamplingParams(temperature=temperature, max_tokens=max_tokens)
        lora = LoRARequest(company_id, _lora_int_id(company_id), adapter_dir)
        outputs = self.llm.chat(conversation, sampling, lora_request=lora)
        content = outputs[0].outputs[0].text if outputs and outputs[0].outputs else ""

        from src.serving.warm_state import mark_warm
        mark_warm(company_id)
        return {
            "content": content,
            "tool_calls": _parse_tool_calls(content),
            "model": f"wd-{company_id}",
        }


def _parse_tool_calls(content: str) -> list[dict]:
    """Extract <tool_call>{...}</tool_call> blocks from the model output."""
    import json
    import re
    tool_calls = []
    for match in re.finditer(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", content, re.DOTALL):
        try:
            tool_calls.append(json.loads(match.group(1)))
        except json.JSONDecodeError:
            pass
    return tool_calls


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
    from src.serving.modal_bridge import set_gpu_serving, set_gpu_warm

    server = HermesServer()
    set_gpu_serving(server.chat_completion)
    set_gpu_warm(server.warm)

    from src.api.main import app as fastapi

    return fastapi
