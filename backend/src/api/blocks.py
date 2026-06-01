"""Parse the daemon's final reply into the webapp's {blocks, suggestions} shape.

The agent system prompt asks for a single JSON object. Models sometimes wrap it in
prose or code fences; this extracts the JSON robustly and always returns a valid
structure (falling back to a single text block) so the UI never breaks.
"""

from __future__ import annotations

import json
import re


def parse_blocks(text: str) -> dict:
    if not text:
        return {"blocks": [], "suggestions": []}

    obj = _extract_json(text)
    if isinstance(obj, dict) and "blocks" in obj:
        blocks = obj.get("blocks") or []
        sugs = obj.get("suggestions") or []
        if isinstance(blocks, list):
            return {"blocks": blocks, "suggestions": sugs if isinstance(sugs, list) else []}

    # Fallback: render the raw text as one markdown text block.
    return {"blocks": [{"type": "text", "md": text.strip()}], "suggestions": []}


def _extract_json(text: str):
    t = text.strip()
    # strip ```json … ``` fences if present
    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", t, re.DOTALL)
    if fence:
        t = fence.group(1).strip()
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        pass
    # grab the first {...} balanced-ish span
    start = t.find("{")
    end = t.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(t[start:end + 1])
        except json.JSONDecodeError:
            return None
    return None
