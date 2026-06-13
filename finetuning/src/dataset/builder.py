from __future__ import annotations

import hashlib
import json
import logging
import os
import tempfile

import src.db as db
from src.config import settings
from src.dataset import formatters

logger = logging.getLogger(__name__)


# ── Train/eval split (Phase 4 quality gate) ──────────────────────────────────────


def example_io(example: dict) -> tuple[str, str]:
    """The (user prompt, reference answer) of a built SFT example — the last user
    turn and the final assistant turn. Used to score gate candidates."""
    msgs = example["messages"]
    user = next((m["content"] for m in reversed(msgs) if m["role"] == "user"), "")
    target = msgs[-1]["content"] if msgs else ""
    return user, target


def split_train_eval(
    examples: list[dict], eval_frac: float = 0.1
) -> tuple[list[dict], list[dict]]:
    """Deterministic train/eval split keyed on a hash of the normalised prompt, so
    a given example always lands on the same side across runs (the gate never
    trains on what it evaluates). Returns (train, eval)."""
    cutoff = max(0, min(100, int(round(eval_frac * 100))))
    train: list[dict] = []
    evalset: list[dict] = []
    for ex in examples:
        user, _ = example_io(ex)
        bucket = int(hashlib.sha1(_norm(user).encode()).hexdigest(), 16) % 100
        (evalset if bucket < cutoff else train).append(ex)
    return train, evalset


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


def build_from_brain(
    company_id: str,
    company_name: str,
    window_hours: int | None = None,
) -> list[dict]:
    """Phase 2: build training examples from the LIVE WorkDaemon brain — real
    daemon conversations, human-accepted actions, and learned skills. This is what
    turns the company's own accumulated data into its model's training set (the
    deep Slack/brain corpus + the approve/edit/reject reward signal we built).

    Behaviour, not volatile facts: every example is a prompt→target the daemon
    actually produced or a human accepted. Returns deduped examples.
    """
    if window_hours is None:
        window_hours = settings.training_window_hours

    candidates: list[tuple[str, dict, float, str]] = []

    # 1. Real conversations → user→assistant SFT pairs (the daemon's good answers,
    #    in this company's voice + grounded in its knowledge).
    msgs = db.get_daemon_conversations(company_id, window_hours)
    for user_text, assistant_text in _pair_turns(msgs):
        if not user_text.strip() or not formatters.is_valid_answer(assistant_text):
            continue
        ex = formatters._make_example(  # type: ignore[attr-defined]
            system=formatters.SYSTEM_PROMPT(company_name),
            user=user_text,
            assistant=assistant_text,
        )
        candidates.append((_norm(user_text), ex, 0.8, ""))

    # 2. Human-ACCEPTED actions → the reward signal (approved/applied = good output).
    for act in db.get_accepted_actions(company_id, window_hours):
        ex = formatters.format_action(act, company_name)
        if not formatters.is_valid_answer(ex["messages"][-1]["content"]):
            continue
        candidates.append((_norm(ex["messages"][1]["content"]), ex, 1.0, ""))

    # 3. Learned skills → how this company operates.
    for sk in db.get_brain_skills(company_id):
        ex = formatters.format_skill(sk, company_name)
        if not formatters.is_valid_answer(ex["messages"][-1]["content"]):
            continue
        candidates.append((_norm(ex["messages"][1]["content"]), ex, 0.9, ""))

    examples, _ = _deduplicate_with_ids(candidates)
    logger.info(
        "company=%s built %d examples from the live brain (conversations=%d, window=%dh)",
        company_id, len(examples), len(msgs), window_hours,
    )
    return examples


def merge_examples(*example_lists: list[dict]) -> list[dict]:
    """Combine example sets, one per normalised user message (earlier lists win
    ties — pass brain examples first so they beat legacy signals)."""
    best: dict[str, dict] = {}
    for examples in example_lists:
        for ex in examples:
            user = next((m["content"] for m in ex["messages"] if m["role"] == "user"), "")
            key = _norm(user)
            if key and key not in best:
                best[key] = ex
    return list(best.values())


def _pair_turns(msgs: list[dict]) -> list[tuple[str, str]]:
    """Pair each user message with the assistant reply that immediately follows it.
    The live daemon_messages assistant role is "daemon" (not "assistant"); accept
    both. Assistant content is cleaned from its stored envelope to prose."""
    pairs: list[tuple[str, str]] = []
    pending_user: str | None = None
    for m in msgs:
        role, content = m.get("role"), m.get("content") or ""
        if role == "user":
            pending_user = content
        elif role in ("assistant", "daemon") and pending_user is not None:
            pairs.append((pending_user, formatters.clean_assistant(content)))
            pending_user = None
    return pairs


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
