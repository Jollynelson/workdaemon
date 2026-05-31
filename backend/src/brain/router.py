"""The Brain router — FINAL spec Section 10 + DeepSeek change-spec Sections 2/2b.

Three destinations with an escalation path:

    depth="deep"       → V4 Pro,   thinking ON,  effort=max     (nightly, strategic, hard patterns)
    depth="technical"  → Flash(mod)/Pro(complex), thinking ON   (code/spreadsheet/data work)
    depth="fast"       → V4 Flash, thinking OFF                  (triage, alerts, routing)
                          └─ if confidence < threshold OR flagged_complex → ESCALATE to Pro

Agent (per-staff interactive) calls do NOT come here — they proxy straight to the
staff member's Hermes API server. Only Brain-layer reasoning is routed here.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from src.brain.deepseek_client import BrainClient, BrainResponse
from src.config import settings

logger = logging.getLogger(__name__)

_COMPLEX_WORDS = ("refactor", "redesign", "debug", "architecture", "optimize", "migrate")


@dataclass
class TierConfig:
    model: str
    thinking: bool
    reasoning_effort: str | None


def _tiers() -> dict[str, TierConfig]:
    return {
        "deep": TierConfig(settings.brain_deep_model, True, settings.brain_deep_reasoning_effort),
        "fast": TierConfig(settings.brain_fast_model, False, None),
        "technical_moderate": TierConfig(
            settings.brain_fast_model, True, settings.brain_technical_reasoning_effort
        ),
        "technical_complex": TierConfig(
            settings.brain_deep_model, True, settings.brain_deep_reasoning_effort
        ),
    }


class BrainRouter:
    """Routes a Brain call to the right DeepSeek tier, with escalation logging."""

    def __init__(self, client: BrainClient, on_escalation: Any | None = None) -> None:
        self._client = client
        self._on_escalation = on_escalation  # optional callback(prompt, reason) for telemetry

    def call(
        self,
        *,
        kind: str = "brain",
        depth: str = "fast",
        prompt: str,
        task_type: str = "triage",
        system: str | None = None,
        context: dict | None = None,
        **kwargs: Any,
    ) -> BrainResponse:
        if kind != "brain":
            raise ValueError("BrainRouter only handles kind='brain'; agent calls proxy to Hermes")

        tiers = _tiers()
        context = context or {}

        if depth == "deep":
            tier_key = "deep"
        elif depth == "technical":
            complexity = self.classify_technical_complexity(prompt, context)
            tier_key = "technical_complex" if complexity == "complex" else "technical_moderate"
        else:
            tier_key = "fast"

        tier = tiers[tier_key]
        resp = self._client.complete(
            prompt,
            model=tier.model,
            thinking=tier.thinking,
            reasoning_effort=tier.reasoning_effort,
            system=system,
            **kwargs,
        )

        # Escalation gate — real logic, not a comment. Only the fast (Flash, no-think)
        # tier escalates; technical_moderate already has thinking on.
        if tier_key == "fast" and self._should_escalate(resp):
            reason = (
                "low_confidence"
                if resp.confidence < settings.brain_escalation_confidence_threshold
                else "flagged_complex"
            )
            logger.info("brain escalate fast→deep reason=%s conf=%.2f", reason, resp.confidence)
            if self._on_escalation:
                self._on_escalation(prompt, reason)
            deep = tiers["deep"]
            resp = self._client.complete(
                prompt,
                model=deep.model,
                thinking=deep.thinking,
                reasoning_effort=deep.reasoning_effort,
                system=system,
                **kwargs,
            )
            resp.escalated = True

        return resp

    def _should_escalate(self, resp: BrainResponse) -> bool:
        return (
            resp.confidence < settings.brain_escalation_confidence_threshold
            or resp.flagged_complex
        )

    def classify_technical_complexity(self, prompt: str, context: dict) -> str:
        """Cheap heuristic (DeepSeek change-spec 2b): complex if multi-file/sheet,
        write/modify intent, or large context. ≥2 signals → complex → Pro."""
        threshold = settings.brain_technical_file_threshold
        signals = [
            len(context.get("files", []) or []) > threshold,
            len(context.get("sheets", []) or []) > threshold,
            len(context.get("tables", []) or []) > threshold,
            any(w in prompt.lower() for w in _COMPLEX_WORDS),
            int(context.get("estimated_tokens", 0) or 0) > 50_000,
        ]
        return "complex" if sum(signals) >= 2 else "moderate"


def default_router() -> BrainRouter:
    """Production router wired to the real DeepSeek backend."""
    from src.brain.deepseek_client import DeepSeekClient

    return BrainRouter(
        DeepSeekClient(settings.deepseek_api_key, settings.deepseek_base_url)
    )
