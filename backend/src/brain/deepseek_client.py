"""DeepSeek V4 client — OpenAI-compatible, behind a small Protocol.

The router depends only on `BrainClient` (the Protocol), so it can be unit-tested
with a fake and the real model strings / base_url stay config-driven. DeepSeek is
OpenAI- and Anthropic-compatible; we use the OpenAI SDK shape.

VERIFY BEFORE PRODUCTION: the model IDs (deepseek-v4-pro / deepseek-v4-flash),
the 1M context, and the thinking / reasoning_effort request params against
DeepSeek's live API. They are isolated here so confirming them is a config/edit
in one file, not a rewrite.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass
class BrainResponse:
    """Normalized result of a Brain call."""

    text: str
    model: str
    confidence: float = 1.0          # parsed from the model's structured output if present
    flagged_complex: bool = False    # the model can self-flag "this needs more depth"
    escalated: bool = False
    thinking: bool = False
    raw: dict = field(default_factory=dict)

    def json(self) -> Any:
        """Best-effort parse of the text as JSON (hunts/routing return JSON)."""
        try:
            return json.loads(self.text)
        except (json.JSONDecodeError, TypeError):
            return None


class BrainClient(Protocol):
    """What the router needs from any Brain backend."""

    def complete(
        self,
        prompt: str,
        *,
        model: str,
        thinking: bool,
        reasoning_effort: str | None,
        system: str | None = None,
        **kwargs: Any,
    ) -> BrainResponse: ...


class DeepSeekClient:
    """Real DeepSeek backend via the OpenAI-compatible API."""

    def __init__(self, api_key: str, base_url: str) -> None:
        self._api_key = api_key
        self._base_url = base_url
        self.__client: Any | None = None

    def _client(self) -> Any:
        if self.__client is None:
            if not self._api_key:
                raise RuntimeError("DEEPSEEK_API_KEY is not set")
            from openai import OpenAI  # lazy: importing the router must not need openai

            self.__client = OpenAI(api_key=self._api_key, base_url=self._base_url)
        return self.__client

    def complete(
        self,
        prompt: str,
        *,
        model: str,
        thinking: bool,
        reasoning_effort: str | None,
        system: str | None = None,
        **kwargs: Any,
    ) -> BrainResponse:
        messages: list[dict] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        # DeepSeek thinking mode needs BOTH params (verified against api-docs.deepseek.com):
        #   thinking={"type": "enabled"|"disabled"} AND reasoning_effort="high"|"max".
        # They're non-OpenAI params, so the OpenAI SDK must pass them via extra_body
        # (kwargs at the top level get stripped). Default effort is "high".
        extra_body: dict[str, Any] = {
            "thinking": {"type": "enabled" if thinking else "disabled"}
        }
        if thinking:
            extra_body["reasoning_effort"] = reasoning_effort or "high"

        resp = self._client().chat.completions.create(
            model=model,
            messages=messages,
            max_tokens=kwargs.get("max_tokens", 4096),
            extra_body=extra_body,
        )
        choice = resp.choices[0]
        text = choice.message.content or ""
        # Deep/thinking tier returns its chain-of-thought separately in reasoning_content.
        reasoning = getattr(choice.message, "reasoning_content", None)

        # Convention: structured Brain prompts ask for a trailing JSON object with
        # "confidence" and optional "flagged_complex"; parse it if present.
        confidence, flagged = _extract_signal(text)
        return BrainResponse(
            text=text,
            model=model,
            confidence=confidence,
            flagged_complex=flagged,
            thinking=thinking,
            raw={
                "finish_reason": getattr(choice, "finish_reason", None),
                "reasoning_content": reasoning,
            },
        )


def _extract_signal(text: str) -> tuple[float, bool]:
    """Pull confidence / flagged_complex from a model response if it embedded them."""
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            conf = float(obj.get("confidence", 1.0))
            return max(0.0, min(1.0, conf)), bool(obj.get("flagged_complex", False))
    except (json.JSONDecodeError, TypeError, ValueError):
        pass
    return 1.0, False
