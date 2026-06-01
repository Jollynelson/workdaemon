"""Optional integrations (FINAL spec §3) — all no-op unless their key is set.

Keeps the "minimize paid tools" stance: nothing here is required, and each turns
on only when configured. None blocks the core jobs.

- trace(): LangSmith span wrapper (records Brain calls). No key → passthrough.
- web_learning(): Tavily/Firecrawl per-company world-news. No key → skipped.
- self_optimise(): DSPy prompt optimisation. Not installed → skipped.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from src.config import settings


@contextmanager
def trace(name: str, **metadata) -> Iterator[None]:
    """Wrap a unit of Brain work in a LangSmith span if configured, else passthrough."""
    if not settings.langsmith_api_key:
        yield
        return
    try:
        from langsmith import traceable  # noqa: F401  (presence check)
        # langsmith's context tooling varies by version; we record a lightweight
        # run via the SDK client to avoid coupling to a specific decorator API.
        from langsmith import Client

        client = Client(api_key=settings.langsmith_api_key)
        run = client.create_run(name=name, run_type="chain", inputs=metadata,
                                project_name=settings.langsmith_project)
        try:
            yield
        finally:
            if run is not None:
                client.update_run(run.id, outputs={"ok": True})
    except Exception:
        # never let observability break the work
        yield


def web_learning(company_id: str, query: str) -> list[dict]:
    """Fetch fresh world/market signals for a company. Empty list if not configured."""
    if not settings.tavily_api_key:
        return []
    try:
        from tavily import TavilyClient

        res = TavilyClient(api_key=settings.tavily_api_key).search(query, max_results=5)
        return [{"title": r.get("title"), "url": r.get("url"), "content": r.get("content")}
                for r in res.get("results", [])]
    except Exception:
        return []


def self_optimise(company_id: str) -> dict:
    """DSPy-based prompt optimisation hook. Skipped unless dspy is installed.

    Placeholder for the spec's self_optimise loop: in a full build this compiles
    better retrieval/prompt strategies from logged outcomes. We expose the hook so
    the scheduler can call it; it no-ops cleanly until dspy + a training set exist.
    """
    try:
        import dspy  # noqa: F401
    except Exception:
        return {"company_id": company_id, "self_optimise": "skipped (dspy not installed)"}
    return {"company_id": company_id, "self_optimise": "noop (no optimiser configured yet)"}
