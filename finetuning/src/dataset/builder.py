from __future__ import annotations

import json
import logging
import os
import tempfile

import src.db as db
from src.config import settings
from src.dataset import formatters

logger = logging.getLogger(__name__)


def build_from_signals(
    company_id: str,
    company_name: str,
    window_hours: int | None = None,
) -> tuple[list[dict], list[str]]:
    """
    The dataset builder (spec Section 6.2): build a JSONL from the
    `training_signals` table that the interaction logger populates.

    This is the learning loop — interactions logged by brain/logger.py flow
    here into the next fine-tune. Behavior, not facts: every signal is a
    prompt→target behavior pair, never a volatile company fact.

    Returns (examples, consumed_signal_ids). The caller marks the signal IDs
    as used_in_version after a successful + gated deploy so they aren't
    retrained on every cycle. The ~10% eval holdout is excluded here (never
    trained on) and consumed by the quality gate instead.
    """
    if window_hours is None:
        window_hours = settings.training_window_hours

    signals = db.get_unused_training_signals(company_id, window_hours)

    # (normalized_prompt, example, score, signal_id)
    candidates: list[tuple[str, dict, float, str]] = []
    for sig in signals:
        target = sig.get("target", "")
        if not formatters.is_valid_answer(target):
            continue
        if _is_eval_holdout(signal_holdout_key(sig)):
            continue
        example = formatters._make_example(  # type: ignore[attr-defined]
            system=formatters.SYSTEM_PROMPT(company_name),
            user=sig["prompt"],
            assistant=target,
        )
        score = sig.get("score") or 0.7
        candidates.append((_norm(sig["prompt"]), example, score, sig["id"]))

    # Terminology from the canonical table (always included, teaches usage)
    for row in db.get_company_terminology(company_id):
        if not formatters.is_valid_answer(row["definition"]):
            continue
        example = formatters.format_terminology(row, company_name)
        candidates.append((_norm(f"what is {row['term']}"), example, 1.0, ""))

    examples, consumed_ids = _deduplicate_with_ids(candidates)

    logger.info(
        "company=%s built %d examples from %d training_signals (window=%dh)",
        company_id, len(examples), len(signals), window_hours,
    )
    return examples, consumed_ids


def write_jsonl(examples: list[dict], company_id: str) -> str:
    """Write examples to a named temp file and return the path."""
    fd, path = tempfile.mkstemp(prefix=f"{company_id}-", suffix=".jsonl")
    with os.fdopen(fd, "w") as f:
        for ex in examples:
            f.write(json.dumps(ex) + "\n")
    return path


# ── Helpers ────────────────────────────────────────────────────────────────────


def _norm(text: str) -> str:
    """Normalise a query for deduplication: lowercase + collapse whitespace."""
    return " ".join(text.lower().split())


def _is_eval_holdout(holdout_key: str) -> bool:
    """Deterministic ~10% holdout keyed on a UUID. Never changes."""
    return int(holdout_key.replace("-", ""), 16) % 10 == 0


def signal_holdout_key(sig: dict) -> str:
    """
    The holdout key for a training_signal: its source interaction_id when present,
    else its own id. Shared by the builder (excludes holdout) and the gate
    (evaluates on holdout) so the two never drift.
    """
    return sig.get("interaction_id") or sig["id"]


def _deduplicate_with_ids(
    candidates: list[tuple[str, dict, float, str]],
) -> tuple[list[dict], list[str]]:
    """One example per normalised prompt (highest score wins); also returns the
    consumed signal IDs (excluding empty terminology IDs)."""
    best: dict[str, tuple[dict, float, str]] = {}
    for norm_query, example, score, sig_id in candidates:
        if norm_query not in best or score > best[norm_query][1]:
            best[norm_query] = (example, score, sig_id)
    examples = [ex for ex, _, _ in best.values()]
    consumed = [sid for _, _, sid in best.values() if sid]
    return examples, consumed
