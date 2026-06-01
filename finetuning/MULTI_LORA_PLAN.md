# Multi-LoRA Serving — Migration Plan (build when multiple companies have trained models)

## Why
Current serving (`finetuning/modal/serve_app.py`) loads a **merged full GGUF per
company** into Ollama. A T4 (16GB) holds ~2–3 full models; beyond that it swaps
from disk (seconds of lag). That caps a GPU at a handful of companies.

Multi-LoRA keeps **one base model resident** + **hot-swaps tiny per-company LoRA
adapters per request** → one GPU serves **dozens–hundreds** of companies, each
still its own brain. This is what makes self-hosted economical at scale.

## What changes
1. **Training export** (`src/training/train.py`): stop merging the adapter into a
   full GGUF. Keep + push the **LoRA adapter (safetensors)** un-merged. (We already
   push the adapter to HF via `registry.push`; just stop relying on the merged GGUF
   for serving.)
2. **Serving** (`serve_app.py`): replace Ollama with **vLLM** (Modal has first-class
   vLLM support):
   - load base `Hermes-3-Llama-3.1-8B` once into VRAM,
   - register company adapters by `company_id` (vLLM `LoRARequest`),
   - per request, generate with that company's adapter.
3. **Router** (`src/model/router.py`) + backend `CompanyModel`: unchanged contract —
   still `{company_id, system_prompt, messages}`; serving picks the adapter.
4. **Autoscale**: `max_containers` already set; vLLM batches concurrent requests
   across adapters, so one GPU handles many companies' concurrent chats.

## What does NOT change
- Each company still trains + owns its adapter (`wd-{company_id}`).
- Isolation (one request → one company's adapter + context) holds.
- 48h per-company retrain + quality gate + hybrid routing all unchanged.

## Trigger to build
When ≥ ~3 real companies have deployed adapters AND are being chatted with — i.e.
when per-company full-GGUF swapping becomes the bottleneck. Until then, the
current scale-to-zero serving is fine and cheaper to operate.

## Cost effect
Turns "1 GPU per active company" into "1 shared GPU for many companies" → the
per-company GPU cost collapses toward ~$0; you scale GPUs by **total concurrent
chat**, not company count.
