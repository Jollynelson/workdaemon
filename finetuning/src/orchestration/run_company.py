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
from src.evaluation.gate import run_gate
from src.registry.hf_registry import pull_gguf, repo_name
from src.serving.ollama_loader import (
    eval_model_name,
    load_into_ollama,
    model_name,
    remove_from_ollama,
)

logger = logging.getLogger(__name__)


def run_company(company_id: str) -> None:
    """
    Full fine-tuning pipeline for one company.
    Blocks until training completes (Modal call is synchronous from the caller's
    perspective). Safe to call concurrently for different company_ids.
    """
    # ── 1. Resolve company ─────────────────────────────────────────────────────
    company_name = db.get_company_name(company_id)
    logger.info("company=%s (%s) fine-tuning run started.", company_id, company_name)

    # ── 2. Build dataset — the LIVE brain is the primary source (Phase 2): real
    # daemon conversations + human-accepted actions + learned skills. Legacy
    # training_signals are merged in behind it (brain wins ties). ───────────────
    brain_examples = build_from_brain(company_id, company_name)
    signal_examples, consumed_signal_ids = build_from_signals(company_id, company_name)
    examples = merge_examples(brain_examples, signal_examples)
    count = len(examples)
    logger.info(
        "company=%s dataset: %d examples (%d brain + %d signal, deduped).",
        company_id, count, len(brain_examples), len(signal_examples),
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

    # ── 6. Pull GGUF from HF ──────────────────────────────────────────────────
    gguf_path = pull_gguf(company_id, version)

    # ── 7. Identify current deployed model (for gate comparison) ──────────────
    deployed_version = db.get_deployed_version(company_id)
    old_ollama_model = model_name(company_id) if deployed_version else None

    # ── 8. Load new model into Ollama temporarily for gate evaluation ──────────
    new_eval_model = eval_model_name(company_id)
    load_into_ollama(company_id, gguf_path, company_name, name=new_eval_model)

    # ── 9. Run quality gate ────────────────────────────────────────────────────
    try:
        gate_result = run_gate(
            company_id=company_id,
            company_name=company_name,
            new_ollama_model=new_eval_model,
            old_ollama_model=old_ollama_model,
        )
    finally:
        # Always clean up the temp eval model, gate pass or fail.
        remove_from_ollama(new_eval_model)

    # ── 10. Write model_versions row (audit trail — always written) ────────────
    mv_row = db.insert_model_version(
        company_id=company_id,
        version=version,
        hf_repo=repo_name(company_id),
        hf_revision=result["hf_revision"],
        eval_score=gate_result["new_score"],
        deployed=False,
        num_examples=result["num_examples"],
    )

    # ── 11. Deploy or hold ─────────────────────────────────────────────────────
    if gate_result["should_deploy"]:
        load_into_ollama(company_id, gguf_path, company_name)
        db.mark_version_deployed(mv_row["id"])
        # Stamp the consumed signals so they aren't retrained next cycle. We only
        # mark on deploy: if the gate rejects, the signals stay unused and get
        # retried next cycle with more data (spec §6.5).
        db.mark_signals_used(company_id, consumed_signal_ids, version)
        logger.info(
            "company=%s v%d DEPLOYED. new_score=%.3f old_score=%.3f. Marked %d signals used.",
            company_id, version,
            gate_result["new_score"], gate_result["old_score"], len(consumed_signal_ids),
        )
    else:
        logger.info(
            "company=%s v%d NOT deployed — new_score=%.3f < old_score=%.3f - ε=%.3f. "
            "Keeping current adapter. %d signals left unused for next cycle.",
            company_id, version,
            gate_result["new_score"], gate_result["old_score"], settings.gate_epsilon,
            len(consumed_signal_ids),
        )
