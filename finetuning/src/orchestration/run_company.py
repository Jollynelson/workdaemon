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
from src.dataset.builder import (
    build_from_brain,
    build_from_signals,
    example_io,
    merge_examples,
    split_train_eval,
    write_jsonl,
)
from src.dataset.qa_synth import build_qa_from_corpus
from src.evaluation.gate import run_serve_gate
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

    # ── 3. Hold out ~10% for the gate (deterministic — never trained on) ───────
    train_examples, eval_examples = split_train_eval(examples)
    eval_pairs = [example_io(ex) for ex in eval_examples]
    logger.info(
        "company=%s split: %d train / %d held-out eval examples.",
        company_id, len(train_examples), len(eval_examples),
    )

    # ── 4. Write JSONL (train split only) ──────────────────────────────────────
    jsonl_path = write_jsonl(train_examples, company_id)
    dataset_jsonl = Path(jsonl_path).read_text()

    # ── 5. Capture the model to beat (BEFORE inserting the candidate) ──────────
    current = db.get_deployed_version(company_id)
    old_revision = current["hf_revision"] if current else None

    version = db.get_next_version_number(company_id)
    logger.info("company=%s training adapter v%d ...", company_id, version)

    # ── 6. Train on Modal GPU ─────────────────────────────────────────────────
    # Import here to avoid requiring Modal auth just to import this module.
    from modal_app import run_training

    result: dict = run_training.remote(company_id, dataset_jsonl, version)
    logger.info(
        "company=%s Modal training complete: revision=%s examples=%d",
        company_id, result["hf_revision"], result["num_examples"],
    )

    # ── 7. Register the candidate as NOT deployed (the contract: a failed gate
    # leaves a deployed=False row; what's already live is untouched). ───────────
    mv_row = db.insert_model_version(
        company_id=company_id,
        version=version,
        hf_repo=repo_name(company_id),
        hf_revision=result["hf_revision"],
        eval_score=None,
        deployed=False,
        num_examples=result["num_examples"],
    )

    # ── 8. Quality gate: beat the current deployed model on the held-out eval,
    # generating through the REAL vLLM serve. Promote ONLY on a win. The first
    # model (old_revision is None) auto-passes if it produces answers. ──────────
    gate = run_serve_gate(
        company_id, company_name, eval_pairs,
        new_revision=result["hf_revision"], old_revision=old_revision,
    )
    db.set_version_eval_score(mv_row["id"], gate["new_score"])

    if gate["should_deploy"]:
        db.promote_version(mv_row["id"], company_id)
        logger.info(
            "company=%s v%d DEPLOYED — gate new=%.3f >= old=%.3f (answered %d/%d). "
            "Adapter revision=%s, served via vLLM.",
            company_id, version, gate["new_score"], gate["old_score"],
            gate["new_answered"], gate["num_eval_examples"], result["hf_revision"][:8],
        )
    else:
        logger.warning(
            "company=%s v%d NOT deployed — gate new=%.3f < old=%.3f (answered %d/%d). "
            "Current model stays live; candidate kept for inspection.",
            company_id, version, gate["new_score"], gate["old_score"],
            gate["new_answered"], gate["num_eval_examples"],
        )

    # Stamp consumed signals so they aren't retrained next cycle (regardless of the
    # gate outcome — they've been incorporated into a trained candidate).
    db.mark_signals_used(company_id, consumed_signal_ids, version)
