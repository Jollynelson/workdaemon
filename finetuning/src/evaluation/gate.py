"""
Quality gate: only deploy a new adapter if it scores >= current - epsilon.

Inference is via Ollama (httpx calls). Scoring uses a provider-configurable LLM
judge (settings.judge_provider, default DeepSeek) to evaluate answer relevance
against the known-good reference answers from the eval holdout set. The same
deterministic 10% holdout used in builder.py is applied here — those examples
were never in the training JSONL.
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

# Per-provider judge config: (OpenAI-compatible base_url | None for SDK, key, default model).
# DeepSeek/OpenAI are OpenAI-compatible → called via httpx (no extra SDK). Anthropic
# uses its own SDK (lazy-imported). Resolved against settings in _judge_config().
_JUDGE_PROVIDERS = {
    "deepseek":  {"base_url": None, "default_model": "deepseek-chat"},
    "openai":    {"base_url": "https://api.openai.com/v1", "default_model": "gpt-4o-mini"},
    "anthropic": {"base_url": None, "default_model": "claude-haiku-4-5-20251001"},
}


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


def _judge_config() -> tuple[str, str, str, str | None]:
    """Resolve (provider, model, api_key, base_url) from settings. Raises if the
    provider is unknown or its key is missing — callers treat that as a scoring
    failure (→ 0.5 fallback) rather than crashing the gate."""
    provider = (settings.judge_provider or "deepseek").lower()
    cfg = _JUDGE_PROVIDERS.get(provider)
    if cfg is None:
        raise ValueError(f"unknown judge_provider {provider!r}")
    model = settings.judge_model or cfg["default_model"]
    key = {
        "deepseek": settings.deepseek_api_key,
        "openai": settings.openai_api_key,
        "anthropic": settings.anthropic_api_key,
    }[provider]
    if not key:
        raise ValueError(f"no API key set for judge_provider {provider!r}")
    base_url = settings.deepseek_base_url + "/v1" if provider == "deepseek" else cfg["base_url"]
    return provider, model, key, base_url


_JUDGE_PROMPT = (
    "You are evaluating an AI assistant's answer against a reference answer.\n\n"
    "Question: {query}\n\n"
    "Reference answer: {reference}\n\n"
    "Generated answer: {answer}\n\n"
    "Score how well the generated answer covers the key information in the reference. "
    "Reply with a single decimal number between 0.0 and 1.0 only. No explanation."
)


def _score_answer(query: str, answer: str, reference: str) -> float:
    """
    Rate how well `answer` addresses `query` compared to `reference`.
    Uses the configured LLM judge (settings.judge_provider). Returns 0.0–1.0.
    Falls back to 0.5 on any error so one bad score doesn't block a deploy.
    """
    if not answer.strip():
        return 0.0

    prompt = _JUDGE_PROMPT.format(query=query, reference=reference, answer=answer)

    try:
        provider, model, key, base_url = _judge_config()

        if provider == "anthropic":
            import anthropic
            client = anthropic.Anthropic(api_key=key)
            msg = client.messages.create(
                model=model, max_tokens=8,
                messages=[{"role": "user", "content": prompt}],
            )
            text = msg.content[0].text
        else:
            # DeepSeek / OpenAI — OpenAI-compatible chat/completions via httpx.
            resp = httpx.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {key}"},
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 8,
                    "temperature": 0.0,
                },
                timeout=30.0,
            )
            resp.raise_for_status()
            text = resp.json()["choices"][0]["message"]["content"]

        return max(0.0, min(1.0, float(text.strip())))
    except Exception as exc:
        logger.warning("Scoring failed (judge=%s): %s", settings.judge_provider, exc)
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


# ── Serve-based gate (Phase 4) ───────────────────────────────────────────────────
# The production gate. Generation runs through the REAL vLLM serve (the deployed
# HermesServer GPU class, reached via Modal RPC — no HTTP/token), scoring a candidate
# adapter revision against the current deployed one on a held-out eval set. The
# decision is made BEFORE anything goes live, so a failed gate never changes what's
# served. Scoring reuses the same LLM judge as run_gate.

SERVE_APP_NAME = os.environ.get("SERVE_APP_NAME", "workdaemon-serving")


def _serve_eval_generate(company_id: str, hf_revision: str, query: str, system_prompt: str) -> str:
    """Generate one answer from a SPECIFIC adapter revision on the deployed serve.
    Returns "" on any failure (→ scored 0.0, the fail-safe handles a dead model)."""
    try:
        import modal

        server = modal.Cls.from_name(SERVE_APP_NAME, "HermesServer")()
        return (server.eval_generate.remote(
            company_id=company_id,
            hf_revision=hf_revision,
            query=query,
            system_prompt=system_prompt,
        ) or "").strip()
    except Exception as exc:
        logger.warning("serve eval-generate failed (rev=%s): %s", (hf_revision or "")[:8], exc)
        return ""


def run_serve_gate(
    company_id: str,
    company_name: str,
    eval_pairs: list[tuple[str, str]],
    new_revision: str,
    old_revision: str | None,
) -> GateResult:
    """Beat-the-old gate over the live serving path.

    Args:
        eval_pairs:   [(prompt, reference_answer), ...] held out from training.
        new_revision: hf_revision of the freshly-trained candidate adapter.
        old_revision: hf_revision of the current deployed adapter, or None on the
                      first-ever model (candidate auto-passes if it answers).

    Returns GateResult; should_deploy is True only when the candidate answers at
    least one prompt AND scores >= old - gate_epsilon.
    """
    if not eval_pairs:
        logger.warning(
            "company=%s no eval pairs — auto-passing serve gate (insufficient data).",
            company_id,
        )
        return GateResult(
            new_score=1.0, old_score=0.0, should_deploy=True,
            num_eval_examples=0, new_answered=0,
        )

    system_prompt = SYSTEM_PROMPT(company_name)
    logger.info(
        "company=%s serve-gate: %d eval examples, new=%s old=%s",
        company_id, len(eval_pairs), (new_revision or "")[:8],
        (old_revision or "none")[:8],
    )

    new_scores: list[float] = []
    old_scores: list[float] = []
    new_answered = 0

    for query, reference in eval_pairs:
        new_answer = _serve_eval_generate(company_id, new_revision, query, system_prompt)
        if new_answer:
            new_answered += 1
        new_scores.append(_score_answer(query, new_answer, reference))

        if old_revision:
            old_answer = _serve_eval_generate(company_id, old_revision, query, system_prompt)
            old_scores.append(_score_answer(query, old_answer, reference))

    mean_new = _mean(new_scores)
    mean_old = _mean(old_scores) if old_scores else 0.0

    if new_answered == 0:
        logger.warning(
            "company=%s serve-gate FAIL-SAFE: candidate answered 0/%d — NOT deploying.",
            company_id, len(eval_pairs),
        )
        should_deploy = False
    else:
        should_deploy = mean_new >= mean_old - settings.gate_epsilon

    logger.info(
        "company=%s serve-gate: new=%.3f old=%.3f answered=%d/%d epsilon=%.3f → deploy=%s",
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
