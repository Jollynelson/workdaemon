"""
Document normalization — every source becomes the same standard format.

Standard document:
{
  "source":    str,          # "slack" | "notion" | "gdrive" | "email" | ...
  "type":      str,          # "message" | "page" | "document" | "meeting" | ...
  "author":    str,          # email or display name
  "timestamp": str,          # ISO 8601
  "content":   str,          # full text (cleaned)
  "metadata":  dict,         # source-specific extras
  "company_id": str,         # always present — isolation guarantee
}
"""

from __future__ import annotations

from datetime import datetime, timezone


def normalize(
    raw: dict,
    source: str,
    doc_type: str,
    company_id: str,
) -> dict:
    """Normalize a raw source document into the standard format."""
    return {
        "source":     source,
        "type":       doc_type,
        "author":     raw.get("author") or raw.get("user") or raw.get("username") or "",
        "timestamp":  _coerce_timestamp(raw),
        "content":    _clean_text(raw.get("content") or raw.get("text") or raw.get("body") or ""),
        "metadata":   {k: v for k, v in raw.items() if k not in ("content", "text", "body")},
        "company_id": company_id,
    }


def _clean_text(text: str) -> str:
    """Basic cleaning — strip excessive whitespace, control chars."""
    import re
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _coerce_timestamp(raw: dict) -> str:
    for key in ("timestamp", "ts", "created_at", "modified_at", "date"):
        val = raw.get(key)
        if val:
            try:
                if isinstance(val, (int, float)):
                    return datetime.fromtimestamp(float(val), tz=timezone.utc).isoformat()
                return str(val)
            except Exception:
                continue
    return datetime.now(timezone.utc).isoformat()
