"""
Bridge between the FastAPI serving layer and the Modal GPU inference function.

The local `modal/` package directory shadows the pip `modal` package when code
runs outside the Modal CLI, so `src/` code must never `import modal` or
`from modal.serve_app import ...`. Instead, the Modal ASGI app (defined in
`modal/serve_app.py`, where the pip `modal` package resolves correctly) injects
the `chat_completion` GPU Function object here at container startup. The router
reads it at request time.

Dev / local runs leave this unset → router uses the local-Ollama path.
On Modal → set to the GPU function → router serves the real per-company model.
"""

from __future__ import annotations

from typing import Any

_gpu_serving_fn: Any | None = None
_gpu_warm_fn: Any | None = None


def set_gpu_serving(fn: Any) -> None:
    """Register the Modal `chat_completion` Function (called from the ASGI app)."""
    global _gpu_serving_fn
    _gpu_serving_fn = fn


def get_gpu_serving() -> Any | None:
    """Return the registered GPU serving Function, or None for local serving."""
    return _gpu_serving_fn


def set_gpu_warm(fn: Any) -> None:
    """Register the Modal `warm` Function (called from the ASGI app)."""
    global _gpu_warm_fn
    _gpu_warm_fn = fn


def get_gpu_warm() -> Any | None:
    """Return the registered GPU warm Function, or None when serving locally."""
    return _gpu_warm_fn
