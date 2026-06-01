"""Normalize connector output to the standard document format (FINAL spec §12)."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Document:
    source: str          # slack | notion | gdrive | github | ...
    type: str            # message | page | file | ...
    content: str
    company_id: str
    author: str | None = None
    timestamp: str | None = None
    metadata: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "source": self.source,
            "type": self.type,
            "author": self.author,
            "timestamp": self.timestamp,
            "content": self.content,
            "metadata": self.metadata,
            "company_id": self.company_id,
        }


def normalize(raw: dict, *, source: str, company_id: str) -> Document:
    """Map a connector's raw item to a Document. Connectors pass field hints in raw."""
    return Document(
        source=source,
        type=raw.get("type", "item"),
        content=raw.get("content", ""),
        company_id=company_id,
        author=raw.get("author"),
        timestamp=raw.get("timestamp"),
        metadata=raw.get("metadata", {}),
    )
