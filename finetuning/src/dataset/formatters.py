from __future__ import annotations

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
