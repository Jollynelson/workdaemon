"""
Modal app — GPU training function for the WorkDaemon fine-tuning pipeline.

The image installs torch+CUDA first, then Unsloth (which depends on a
CUDA-enabled torch). If Unsloth releases a new version that changes its
install command, update the pip_install calls below accordingly.
"""

from __future__ import annotations

import modal

# ── Docker image ───────────────────────────────────────────────────────────────
# Layer 1: system deps
# Layer 2: torch with CUDA 12.1 (must precede Unsloth)
# Layer 3: Unsloth + all training deps
# Layer 4: local src/ package (mounted so imports work inside the container)

image = (
    modal.Image.debian_slim(python_version="3.11")
    # Layer 1: system deps + llama.cpp build deps for Unsloth GGUF export
    .apt_install(
        "git", "build-essential", "curl",
        "libssl-dev", "libcurl4-openssl-dev", "cmake",
    )
    # Layer 2: pre-build llama.cpp so Unsloth finds it at /root/.unsloth/llama.cpp
    # and doesn't try to run an interactive install prompt inside the container.
    # CPU-only build is sufficient — GGUF quantization doesn't need the GPU.
    .run_commands(
        "mkdir -p /root/.unsloth",
        "git clone --depth 1 https://github.com/ggerganov/llama.cpp /root/.unsloth/llama.cpp",
        "cd /root/.unsloth/llama.cpp && cmake -B build && cmake --build build --config Release -j$(nproc)",
    )
    # Layer 3: torch with CUDA (must precede Unsloth).
    # Bumped 2026-06-04 for Gemma 4 support — the old torch 2.3.1/cu121 +
    # unsloth[cu121-torch231] pins predate Gemma 4's arch. ⚠️ VALIDATE these pins
    # with a real `modal deploy` + test train; a 1-day-old release's dep matrix
    # can shift. If the build breaks, fall back to Unsloth's version-agnostic
    # install (`pip install unsloth unsloth_zoo`, no extra tag) which auto-resolves
    # a compatible torch, or pin to whatever Unsloth's Gemma 4 docs recommend.
    .pip_install(
        "torch==2.7.0",
        index_url="https://download.pytorch.org/whl/cu124",
    )
    # Layer 4: Unsloth (latest — Gemma 4 support landed at release) + training deps
    .pip_install(
        "unsloth",
        "unsloth_zoo",
    )
    .pip_install(
        "trl>=0.8.0",
        "transformers>=4.40.0",
        "datasets>=2.18.0",
        "huggingface_hub>=0.22.0",
        "peft>=0.10.0",
        "accelerate>=0.28.0",
        "bitsandbytes>=0.43.0",
        "supabase>=2.4.0",
        "pydantic-settings>=2.2.0",
        "python-dotenv>=1.0.0",
        "anthropic>=0.25.0",
    )
    .add_local_python_source("src")
)

app = modal.App("workdaemon-finetuning")


@app.function(
    image=image,
    gpu="L4",               # 24GB VRAM — 12B QLoRA won't fit T4's 16GB at 8192 seq;
                            # L4 (Ada, bf16) is the cheap fit. Bump to A10G if OOM.
    timeout=60 * 60 * 3,   # 3h hard cap — typical run is ~1–2h
    secrets=[modal.Secret.from_name("workdaemon-secrets")],
)
def run_training(company_id: str, dataset_jsonl: str, version: int) -> dict:
    """
    Train a QLoRA adapter for one company and push it to Hugging Face.

    Args:
        company_id:    The company UUID.
        dataset_jsonl: Full contents of the training JSONL (passed by value to
                       avoid needing a shared volume between caller and container).
        version:       Monotonically increasing version number for this adapter.

    Returns:
        {"version": int, "hf_revision": str, "num_examples": int}
    """
    import os
    import tempfile

    from src.config import settings
    from src.registry.hf_registry import push, push_gguf
    from src.training.hyperparams import HYPERPARAMS
    from src.training.train import train_adapter

    # 1. Write the JSONL string to a temp file on the container's /tmp
    fd, dataset_path = tempfile.mkstemp(prefix=f"{company_id}-", suffix=".jsonl")
    with os.fdopen(fd, "w") as f:
        f.write(dataset_jsonl)

    num_examples = sum(1 for line in dataset_jsonl.splitlines() if line.strip())

    # 2. Fine-tune + export GGUF (train_adapter returns both paths)
    adapter_dir, gguf_path = train_adapter(
        company_id=company_id,
        dataset_path=dataset_path,
        base_model=settings.base_model,
        hp=HYPERPARAMS,
    )

    # 3. Push LoRA adapter (safetensors) and merged GGUF to HF
    hf_revision = push(company_id, adapter_dir, version)
    push_gguf(company_id, gguf_path, version)

    return {
        "version": version,
        "hf_revision": hf_revision,
        "num_examples": num_examples,
    }


# ── CPU orchestrator: the learning-loop entrypoint the backend triggers ─────────
# Lightweight image (no GPU/torch/unsloth) — run_company builds the dataset, calls
# the GPU run_training above via .remote(), runs the quality gate, and deploys the
# adapter. The backend enqueues this per company via Modal lookup (.spawn).
orchestrator_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "supabase>=2.4.0", "huggingface_hub>=0.22.0", "httpx>=0.27.0",
        "pydantic-settings>=2.2.0", "python-dotenv>=1.0.0", "anthropic>=0.25.0",
    )
    .add_local_python_source("src")
)


@app.function(
    image=orchestrator_image,
    timeout=60 * 60 * 4,   # covers the full build→train→gate→deploy cycle
    secrets=[modal.Secret.from_name("workdaemon-secrets")],
)
def run_company_remote(company_id: str) -> dict:
    """Run the full per-company fine-tune cycle (dataset → train → gate → deploy).

    One call = one company (isolation). Safe to .spawn() fire-and-forget from the
    backend's 48h training loop. run_company internally guards on
    MIN_EXAMPLES_TO_TRAIN and the quality gate, so calling it for a company with
    too little data or a worse-scoring adapter is a no-op.
    """
    from src.orchestration.run_company import run_company

    run_company(company_id)
    return {"company_id": company_id, "status": "done"}


@app.function(
    image=orchestrator_image,
    timeout=60 * 30,
    secrets=[modal.Secret.from_name("workdaemon-secrets")],
    schedule=modal.Cron("0 3 */2 * *"),   # every 2 days at 03:00 — the learning loop
)
def training_cycle() -> dict:
    """Scheduled 48h learning loop: find companies with enough new training_signals
    and spawn a fine-tune for each. Lives in the finetuning app (which already has
    Modal + the training code), so the web backend needs no Modal dependency.

    Selection = companies with >= MIN_EXAMPLES_TO_TRAIN unused signals. One spawn
    per company (isolation); run_company self-guards on min-examples + the gate.
    """
    import os

    import src.db as db

    threshold = int(os.environ.get("MIN_EXAMPLES_TO_TRAIN", "50"))
    client = db.db()
    resp = (
        client.table("training_signals")
        .select("company_id")
        .is_("used_in_version", "null")
        .execute()
    )
    counts: dict[str, int] = {}
    for r in resp.data or []:
        cid = r.get("company_id")
        if cid:
            counts[cid] = counts.get(cid, 0) + 1
    ready = [cid for cid, n in counts.items() if n >= threshold]

    for cid in ready:
        run_company_remote.spawn(cid)   # fire-and-forget per company
    return {"ready": len(ready), "company_ids": ready}
