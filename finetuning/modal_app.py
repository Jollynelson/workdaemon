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
    # torch 2.6.0/cu124 + latest Unsloth. (2.7.0 — a leftover from the never-run
    # Gemma 4 commit — does NOT exist on the cu124 wheel index, which tops out at
    # 2.6.0; validated by a failed `modal deploy` 2026-06-04.) Mistral Small 24B is
    # a stable, long-supported arch, so 2.6.0 is a safe, well-tested combo. If a
    # future build breaks, fall back to Unsloth's version-agnostic install
    # (`pip install unsloth unsloth_zoo`, no torch pin) which auto-resolves torch.
    .pip_install(
        "torch==2.6.0",
        index_url="https://download.pytorch.org/whl/cu124",
    )
    # Layer 4: Unsloth (latest) + training deps
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
    gpu="L40S",             # 48GB VRAM — Qwen3-32B QLoRA 4-bit (~19GB weights) does
                            # NOT fit the L4's 24GB (fails at load: "modules dispatched
                            # on CPU/disk"), so we step up to the L40S. Attached to THIS
                            # function only and scale-to-zero, so the L40S is billed
                            # solely during a train (~1-2h), never idle. The 48GB leaves
                            # ample room for seq=4096. (24B-class fits an L4 fine; revert
                            # gpu="L4" + seq=2048 if you ever drop to a ≤24B base.)
    timeout=60 * 60 * 6,   # 6h hard cap — 24B on the slow L4 runs well past the
                           # ~1–2h a 12B took; raise/lower with the GPU choice.
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
    from src.registry.hf_registry import push
    from src.training.hyperparams import HYPERPARAMS
    from src.training.train import train_adapter

    # 1. Write the JSONL string to a temp file on the container's /tmp
    fd, dataset_path = tempfile.mkstemp(prefix=f"{company_id}-", suffix=".jsonl")
    with os.fdopen(fd, "w") as f:
        f.write(dataset_jsonl)

    num_examples = sum(1 for line in dataset_jsonl.splitlines() if line.strip())

    # 2. Fine-tune → LoRA adapter (safetensors). No GGUF merge (Path B: vLLM serves
    #    the un-merged adapter; avoids the brittle Qwen→GGUF converter).
    adapter_dir = train_adapter(
        company_id=company_id,
        dataset_path=dataset_path,
        base_model=settings.base_model,
        hp=HYPERPARAMS,
    )

    # 3. Push the LoRA adapter to the company's private HF repo.
    hf_revision = push(company_id, adapter_dir, version)

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
    timeout=60 * 60 * 7,   # covers the full build→train→gate→deploy cycle (24B
                           # train on L4 dominates; > the GPU fn's 6h cap + margin)
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


@app.function(image=orchestrator_image, secrets=[modal.Secret.from_name("workdaemon-secrets")])
def verify_config() -> dict:
    """Cheap CPU pre-flight: confirm the secret is wired for a real run — effective
    base model + that HF_TOKEN / DB / DeepSeek are present — WITHOUT printing any
    secret value. Run before the first GPU spend: modal run modal_app.py::verify_config"""
    import os
    from src.config import settings
    info = {
        "base_model": settings.base_model,
        "base_is_qwen3_32b": "Qwen3-32B" in settings.base_model,
        "hf_token_set": bool(os.environ.get("HF_TOKEN")),
        "hf_org": os.environ.get("HF_ORG"),
        "deepseek_key_set": bool(settings.deepseek_api_key),
        "database_url_set": bool(settings.database_url),
        "supabase_url_set": bool(settings.supabase_url),
    }
    print("VERIFY_CONFIG:", info)
    return info


@app.function(
    image=orchestrator_image,
    timeout=60 * 30,
    secrets=[modal.Secret.from_name("workdaemon-secrets")],
    schedule=modal.Cron("0 3 */2 * *"),   # every 2 days at 03:00 — the learning loop
)
def training_cycle() -> dict:
    """Scheduled 48h learning loop: find companies whose brain has grown enough to
    be worth a new fine-tune and spawn one each. Lives in the finetuning app (which
    already has Modal + the training code), so the web backend needs no Modal dep.

    A company is READY when EITHER:
      • it has >= MIN_EXAMPLES_TO_TRAIN unused training_signals (the legacy path), OR
      • its brain has grown: >= NEW_MESSAGES_TO_RETRAIN daemon_messages since its
        last deployed version (first-timers: any conversation at all).
    The brain path is what actually fires today — the live app barely writes
    training_signals, but daemon_messages + corpus are the real training corpus.
    One spawn per company (isolation); run_company self-guards on MIN_EXAMPLES and
    the quality gate, so an over-eager pick just no-ops cheaply.
    """
    import os

    import src.db as db

    signal_threshold = int(os.environ.get("MIN_EXAMPLES_TO_TRAIN", "50"))
    new_msg_threshold = int(os.environ.get("NEW_MESSAGES_TO_RETRAIN", "20"))
    client = db.db()

    # Path A — unused training_signals (legacy).
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
    ready: set[str] = {cid for cid, n in counts.items() if n >= signal_threshold}

    # Path B — brain growth since the last deployed version.
    for cid in db.get_active_companies():
        if cid in ready:
            continue
        last = db.get_deployed_version(cid)
        # model_versions stamps the train time as `trained_at` (NOT created_at) —
        # using the wrong key silently counted all-time messages, so a company would
        # look "ready" forever. None (no prior version) → first-timer, counts all.
        since = last.get("trained_at") if last else None
        new_msgs = db.count_daemon_messages_since(cid, since)
        first_time = last is None
        if (first_time and new_msgs >= 1) or (not first_time and new_msgs >= new_msg_threshold):
            ready.add(cid)

    ready_list = sorted(ready)
    for cid in ready_list:
        run_company_remote.spawn(cid)   # fire-and-forget per company
    return {"ready": len(ready_list), "company_ids": ready_list}
