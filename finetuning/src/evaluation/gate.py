"""
Quality gate: only deploy a new adapter if it scores >= current - epsilon.

Inference is via Ollama (httpx calls). Scoring uses Claude as the LLM judge,
evaluating answer relevance against the known-good reference answers from the
eval holdout set. The same deterministic 10% holdout used in builder.py is
applied here — those examples were never in the training JSONL.
"""

from __future__ import annotations

import logging
import os
from typing import TypedDict

import httpx

import src.db as db
from src.config import settings
from src.dataset.builder import _is_eval_holdout, signal_holdout_key
from src.dataset.formatters import SYSTEM_PROMPT

logger = logging.getLogger(__name__)

# Configurable so the gate can target a dedicated Ollama daemon (e.g. a separate
# port from a brain/embedding daemon). Must match where load_into_ollama writes.
OLLAMA_BASE = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
EVAL_MODEL_SUFFIX = "-eval"          # temporary Ollama model name for new adapter
JUDGE_MODEL = "claude-haiku-4-5-20251001"


class GateResult(TypedDict):
    new_score: float
    old_score: float
    should_deploy: bool
    num_eval_examples: int
    new_answered: int          # how many eval prompts the NEW model actually answered


# ── Eval set ───────────────────────────────────────────────────────────────────


def get_eval_pairs(company_id: str, window_hours: int | None = None) -> list[dict]:
    """
    Return the held-out eval signals for this company — the ~10% of
    training_signals that build_from_signals() excluded from the training JSONL.
    Uses the same deterministic holdout key so the split never drifts.

    Each returned signal carries `prompt` (the question) and `target` (the
    known-good reference answer) used to score generated answers.
    """
    if window_hours is None:
        window_hours = settings.training_window_hours

    all_signals = db.get_eval_training_signals(company_id, window_hours)
    return [s for s in all_signals if _is_eval_holdout(signal_holdout_key(s))]


# ── Inference ──────────────────────────────────────────────────────────────────


def _ollama_generate(query: str, model_name: str, company_name: str) -> str:
    """Query an Ollama model. Returns empty string on failure."""
    try:
        resp = httpx.post(
            f"{OLLAMA_BASE}/api/chat",
            json={
                "model": model_name,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT(company_name)},
                    {"role": "user", "content": query},
                ],
                "stream": False,
                "options": {"temperature": 0.3},
            },
            timeout=60.0,
        )
        resp.raise_for_status()
        return resp.json()["message"]["content"].strip()
    except Exception as exc:
        logger.warning("Ollama inference failed (model=%s): %s", model_name, exc)
        return ""


# ── Scoring ────────────────────────────────────────────────────────────────────


def _score_answer(query: str, answer: str, reference: str) -> float:
    """
    Rate how well `answer` addresses `query` compared to `reference`.
    Uses Claude as the judge. Returns 0.0–1.0.
    Falls back to 0.5 on any error so one bad score doesn't block a deploy.
    """
    if not answer.strip():
        return 0.0

    import anthropic

    prompt = (
        "You are evaluating an AI assistant's answer against a reference answer.\n\n"
        f"Question: {query}\n\n"
        f"Reference answer: {reference}\n\n"
        f"Generated answer: {answer}\n\n"
        "Score how well the generated answer covers the key information in the reference. "
        "Reply with a single decimal number between 0.0 and 1.0 only. No explanation."
    )

    try:
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        msg = client.messages.create(
            model=JUDGE_MODEL,
            max_tokens=8,
            messages=[{"role": "user", "content": prompt}],
        )
        return max(0.0, min(1.0, float(msg.content[0].text.strip())))
    except Exception as exc:
        logger.warning("Scoring failed: %s", exc)
        return 0.5


def _mean(scores: list[float]) -> float:
    return sum(scores) / len(scores) if scores else 0.0


# ── Gate ───────────────────────────────────────────────────────────────────────


def run_gate(
    company_id: str,
    company_name: str,
    new_ollama_model: str,
    old_ollama_model: str | None,
) -> GateResult:
    """
    Compare new adapter vs current deployed adapter on the held-out eval set.

    Args:
        company_id:        The company UUID.
        company_name:      Used for the system prompt.
        new_ollama_model:  Ollama model name for the new adapter (already loaded).
        old_ollama_model:  Ollama model name for the current adapter, or None if
                           this is the first run (new adapter is compared to itself
                           and auto-passes).

    Returns:
        GateResult with scores and the deploy decision.
    """
    eval_pairs = get_eval_pairs(company_id)

    if not eval_pairs:
        logger.warning(
            "company=%s has no eval pairs — auto-passing gate (insufficient data).",
            company_id,
        )
        return GateResult(
            new_score=1.0, old_score=0.0, should_deploy=True,
            num_eval_examples=0, new_answered=0,
        )

    logger.info(
        "company=%s running gate on %d eval examples.", company_id, len(eval_pairs)
    )

    new_scores: list[float] = []
    old_scores: list[float] = []
    new_answered = 0          # non-empty generations from the NEW model

    for sig in eval_pairs:
        query = sig["prompt"]
        reference = sig["target"]

        new_answer = _ollama_generate(query, new_ollama_model, company_name)
        if new_answer.strip():
            new_answered += 1
        new_scores.append(_score_answer(query, new_answer, reference))

        if old_ollama_model:
            old_answer = _ollama_generate(query, old_ollama_model, company_name)
            old_scores.append(_score_answer(query, old_answer, reference))

    mean_new = _mean(new_scores)
    # First run: no old model → old_score = 0 so new always passes
    mean_old = _mean(old_scores) if old_scores else 0.0

    # ── FAIL-SAFE ──────────────────────────────────────────────────────────────
    # A model that produced NO usable answers across the entire eval set is
    # non-functional — it couldn't be served, inference errored, or it emits
    # empty output. Never deploy it, regardless of the score arithmetic
    # (0.0 >= 0.0 - epsilon would otherwise pass and ship a dead model).
    if new_answered == 0:
        logger.warning(
            "company=%s gate FAIL-SAFE: new model answered 0/%d eval prompts — "
            "NOT deploying (model unservable or producing empty output).",
            company_id, len(eval_pairs),
        )
        should_deploy = False
    else:
        should_deploy = mean_new >= mean_old - settings.gate_epsilon

    logger.info(
        "company=%s gate: new=%.3f old=%.3f answered=%d/%d epsilon=%.3f → deploy=%s",
        company_id, mean_new, mean_old, new_answered, len(eval_pairs),
        settings.gate_epsilon, should_deploy,
    )

    return GateResult(
        new_score=mean_new,
        old_score=mean_old,
        new_answered=new_answered,
        should_deploy=should_deploy,
        num_eval_examples=len(eval_pairs),
    )
