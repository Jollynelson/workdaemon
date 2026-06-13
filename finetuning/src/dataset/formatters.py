from __future__ import annotations

import json

# Substrings that indicate a broken or error answer — filter these out.
_ERROR_SUBSTRINGS = (
    "error:",
    "traceback",
    "exception:",
    "undefined",
    "internal server error",
    "404 not found",
    "null",
    "n/a",
)

MIN_ANSWER_TOKENS = 5


def SYSTEM_PROMPT(company_name: str) -> str:
    return (
        f"You are the company Brain for {company_name}. "
        "Answer using the company's own knowledge, terminology, and context. "
        "Be precise and cite which source the answer came from when possible."
    )


def _make_example(system: str, user: str, assistant: str) -> dict:
    return {
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
            {"role": "assistant", "content": assistant},
        ]
    }


def format_terminology(term_row: dict, company_name: str) -> dict:
    """Terminology grounding. Teaches the model company-specific language."""
    return _make_example(
        system=SYSTEM_PROMPT(company_name),
        user=f"What is {term_row['term']}?",
        assistant=term_row["definition"],
    )


# ── Live-brain formatters (Phase 2) ─────────────────────────────────────────────

def clean_assistant(content: str) -> str:
    """The SFT target from a stored daemon reply. `daemon_messages` stores the reply
    as {"blocks":[{"md"|"content":...}], "suggestions":[...]} JSON; we keep the
    assembled prose (the actual answer), NOT the envelope — the model learns to
    ANSWER well; the serving layer re-wraps the envelope. Plain-text replies pass
    through unchanged."""
    if not content:
        return ""
    try:
        env = json.loads(content)
    except (ValueError, TypeError):
        return content.strip()
    if isinstance(env, dict) and isinstance(env.get("blocks"), list):
        parts = [
            (b.get("md") or b.get("content") or "")
            for b in env["blocks"]
            if isinstance(b, dict)
        ]
        return "\n\n".join(p.strip() for p in parts if p and p.strip()).strip()
    return content.strip()


def format_action(act: dict, company_name: str) -> dict:
    """A human-ACCEPTED daemon action → instruction→output example (the reward
    signal). The accepted result (edited or as-is) is the target."""
    kind = (act.get("type") or "task").replace("_", " ").strip().title()
    instruction = f"{kind}: {act.get('title') or ''}".strip().rstrip(":").strip()
    target = (act.get("result") or act.get("body") or "").strip()
    return _make_example(SYSTEM_PROMPT(company_name), instruction, target)


def format_skill(skill: dict, company_name: str) -> dict:
    """A learned company skill → how this company operates."""
    trigger = skill.get("trigger_description") or skill.get("name") or ""
    return _make_example(
        SYSTEM_PROMPT(company_name),
        f"How should you handle: {trigger}?",
        (skill.get("body") or "").strip(),
    )


def is_valid_answer(text: str) -> bool:
    """False if the answer is empty, too short, or looks like an error string."""
    if not text or not text.strip():
        return False
    if len(text.split()) < MIN_ANSWER_TOKENS:
        return False
    lowered = text.lower()
    if any(err in lowered for err in _ERROR_SUBSTRINGS):
        return False
    return True
