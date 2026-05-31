from src.dataset.formatters import (
    SYSTEM_PROMPT,
    format_terminology,
    is_valid_answer,
)

COMPANY = "Acme Corp"


def _msgs(ex: dict) -> list[dict]:
    return ex["messages"]


# ── SYSTEM_PROMPT ──────────────────────────────────────────────────────────────


def test_system_prompt_contains_company_name():
    prompt = SYSTEM_PROMPT(COMPANY)
    assert COMPANY in prompt


def test_system_prompt_mentions_knowledge_and_cite():
    prompt = SYSTEM_PROMPT(COMPANY)
    assert "knowledge" in prompt
    assert "cite" in prompt


# ── _make_example (shape used by build_from_signals) ───────────────────────────


def test_make_example_structure():
    from src.dataset.formatters import _make_example
    ex = _make_example(SYSTEM_PROMPT(COMPANY), "What is our Q3 target?", "Five million ARR by September.")
    msgs = _msgs(ex)
    assert len(msgs) == 3
    assert msgs[0]["role"] == "system"
    assert msgs[1]["role"] == "user" and msgs[1]["content"] == "What is our Q3 target?"
    assert msgs[2]["role"] == "assistant" and msgs[2]["content"] == "Five million ARR by September."


# ── format_terminology ─────────────────────────────────────────────────────────


def test_format_terminology_question_form():
    term_row = {"term": "Project Atlas", "definition": "Our internal name for the Stripe migration."}
    ex = format_terminology(term_row, COMPANY)
    assert _msgs(ex)[1]["content"] == "What is Project Atlas?"


def test_format_terminology_answer_is_definition():
    term_row = {"term": "Churn rate", "definition": "Percentage of customers lost per month."}
    ex = format_terminology(term_row, COMPANY)
    assert _msgs(ex)[2]["content"] == "Percentage of customers lost per month."


# ── is_valid_answer ────────────────────────────────────────────────────────────


def test_is_valid_answer_rejects_empty():
    assert not is_valid_answer("")
    assert not is_valid_answer("   ")


def test_is_valid_answer_rejects_short():
    assert not is_valid_answer("yes")          # 1 token
    assert not is_valid_answer("yes no ok")    # 3 tokens


def test_is_valid_answer_accepts_sufficient():
    assert is_valid_answer("The SLA is 99.9% uptime per month guaranteed.")


def test_is_valid_answer_rejects_error_strings():
    assert not is_valid_answer("Error: something went wrong here badly")
    assert not is_valid_answer("Traceback (most recent call last): ...")
    assert not is_valid_answer("404 Not Found on the requested endpoint")


def test_is_valid_answer_case_insensitive_error_check():
    assert not is_valid_answer("INTERNAL SERVER ERROR occurred during the request")
