"""Resilience helpers for outbound model/API calls (production hardening).

retry_call: bounded exponential backoff with jitter, retrying only transient
failures (timeouts, 429 rate-limit, 5xx) — never client errors (4xx auth/validation)
which won't succeed on retry. Used at the DeepSeek + serving call boundaries so a
transient blip doesn't surface as a user-facing 500.
"""

from __future__ import annotations

import logging
import random
import time
from typing import Any, Callable, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")

# substrings that signal a transient, retryable failure
_TRANSIENT = ("429", "rate limit", "rate_limit", "timeout", "timed out",
              "502", "503", "504", "connection", "temporarily")


def _is_transient(exc: Exception) -> bool:
    msg = str(exc).lower()
    # explicit status_code attribute (httpx/openai style)
    code = getattr(exc, "status_code", None) or getattr(getattr(exc, "response", None), "status_code", None)
    if code in (429, 500, 502, 503, 504):
        return True
    return any(t in msg for t in _TRANSIENT)


def retry_call(
    fn: Callable[[], T],
    *,
    attempts: int = 4,
    base_delay: float = 0.5,
    max_delay: float = 8.0,
    label: str = "call",
) -> T:
    """Call fn(); on a transient error, retry with exponential backoff + jitter.
    Re-raises immediately on non-transient errors and after the final attempt."""
    last: Exception | None = None
    for i in range(1, attempts + 1):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001 - we classify below
            last = exc
            if not _is_transient(exc) or i == attempts:
                raise
            delay = min(max_delay, base_delay * (2 ** (i - 1))) * (0.5 + random.random())
            logger.warning("%s transient failure (attempt %d/%d): %s — retrying in %.1fs",
                           label, i, attempts, str(exc)[:120], delay)
            time.sleep(delay)
    assert last is not None
    raise last
