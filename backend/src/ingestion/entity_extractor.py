"""Entity + terminology extraction on ingest (FINAL spec §12).

The Brain (Flash) pulls people / decisions / projects / terms from a document so
they can be written to the knowledge graph and company_terminology. The Brain
call is injected; a deterministic fallback keeps ingestion working without it.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from src.brain.router import BrainRouter

EXTRACT_PROMPT = """Extract entities from this company document. Return ONLY JSON:
{{"people": ["..."], "projects": ["..."], "decisions": ["..."],
  "terms": [{{"term": "...", "definition": "..."}}]}}

Document:
{content}
"""


@dataclass
class Entities:
    people: list[str] = field(default_factory=list)
    projects: list[str] = field(default_factory=list)
    decisions: list[str] = field(default_factory=list)
    terms: list[dict] = field(default_factory=list)


def extract_entities(brain: BrainRouter | None, content: str) -> Entities:
    if brain is None or not content.strip():
        return Entities()
    data = brain.call(kind="brain", depth="fast", task_type="analysis",
                      prompt=EXTRACT_PROMPT.format(content=content[:8000])).json() or {}
    return Entities(
        people=data.get("people", []) or [],
        projects=data.get("projects", []) or [],
        decisions=data.get("decisions", []) or [],
        terms=data.get("terms", []) or [],
    )
