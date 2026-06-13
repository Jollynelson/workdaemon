"""
End-to-end fine-tuning run for a single company.

Called by inngest_functions.py (per-company fan-out handler) and by
scripts/run_one_company.py (manual trigger). Idempotent and safe to retry:
- A failed Modal run leaves no model_versions row and no deployed model.
- If Modal succeeds but the gate fails, model_versions is still written with
  deployed=False — the next cycle picks up from there.
"""

from __future__ import annotations

import logging
from pathlib import Path

import src.db as db
from src.config import settings
from src.dataset.builder import build_from_brain, build_from_signals, merge_examples, write_jsonl
from src.dataset.qa_synth import build_qa_from_corpus
from src.registry.hf_registry import repo_name

logger = logging.getLogger(__name__)


def run_company(company_id: str) -> None:
    """
    Full fine-tuning pipeline for one company.
    Blocks until training completes (Modal call is synchronous from the caller's
    perspective). Safe to call concurrently for different company_ids.
    """
    # ── 1. Resolve company ─────────────────────────────────────────────────────
    company_name = db.get_company_name(company_id)
    # Log the EFFECTIVE base model loudly — a stale BASE_MODEL in the Modal secret
    # silently downgraded the base once; never let that be invisible again.
    logger.info(
        "company=%s (%s) fine-tuning run started — base_model=%s",
        company_id, company_name, settings.base_model,
    )
    if "Qwen3-32B" not in settings.base_model:
        logger.warning(
            "⚠️ base_model is %s, NOT the chosen Qwen3-32B — check BASE_MODEL in the "
            "`workdaemon-secrets` Modal secret.", settings.base_model,
        )

    # ── 2. Build dataset — the LIVE brain is the primary source (Phase 2): real
    # daemon conversations + human-accepted actions + learned skills. Legacy
    # training_signals are merged in behind it (brain wins ties). ───────────────
    brain_examples = build_from_brain(company_id, company_name)
    qa_examples = build_qa_from_corpus(company_id, company_name)  # Phase 2.5: corpus → Q&A
    signal_examples, consumed_signal_ids = build_from_signals(company_id, company_name)
    examples = merge_examples(brain_examples, qa_examples, signal_examples)
    count = len(examples)
    logger.info(
        "company=%s dataset: %d examples (%d brain + %d corpus-Q&A + %d signal, deduped).",
        company_id, count, len(brain_examples), len(qa_examples), len(signal_examples),
    )

    if count < settings.min_examples_to_train:
        logger.info(
            "company=%s SKIP — %d examples, need %d (MIN_EXAMPLES_TO_TRAIN). "
            "Will retry next cycle.",
            company_id, count, settings.min_examples_to_train,
        )
        return

    logger.info("company=%s dataset: %d training examples.", company_id, count)

    # ── 3. Write JSONL ─────────────────────────────────────────────────────────
    jsonl_path = write_jsonl(examples, company_id)
    dataset_jsonl = Path(jsonl_path).read_text()

    # ── 4. Get next version number ────────────────────────────────────────────
    version = db.get_next_version_number(company_id)
    logger.info("company=%s training adapter v%d ...", company_id, version)

    # ── 5. Train on Modal GPU ─────────────────────────────────────────────────
    # Import here to avoid requiring Modal auth just to import this module.
    from modal_app import run_training

    result: dict = run_training.remote(company_id, dataset_jsonl, version)
    logger.info(
        "company=%s Modal training complete: revision=%s examples=%d",
        company_id, result["hf_revision"], result["num_examples"],
    )

    # ── 6. Deploy the adapter (Path B: vLLM serves base+adapter by company_id) ──
    # No GGUF, no Ollama. The adapter is on HF; serving loads it per company_id.
    # The beat-the-old quality gate runs against the vLLM serve endpoint once
    # multi-LoRA serving lands (Layer 2); the FIRST model has nothing to beat, so
    # it deploys, and until the serve-based gate exists a newer adapter (trained on
    # more/newer data) deploys.
    mv_row = db.insert_model_version(
        company_id=company_id,
        version=version,
        hf_repo=repo_name(company_id),
        hf_revision=result["hf_revision"],
        eval_score=None,
        deployed=False,
        num_examples=result["num_examples"],
    )
    db.mark_version_deployed(mv_row["id"])
    # Stamp consumed signals so they aren't retrained next cycle.
    db.mark_signals_used(company_id, consumed_signal_ids, version)
    logger.info(
        "company=%s v%d DEPLOYED — adapter revision=%s, served via vLLM by company_id. "
        "Marked %d signals used.",
        company_id, version, result["hf_revision"][:8], len(consumed_signal_ids),
    )
