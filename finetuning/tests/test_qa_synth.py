"""Phase 2.5: corpus → grounded Q&A training pairs."""
from unittest.mock import patch

from src.dataset.qa_synth import build_qa_from_corpus, extract_json_array

COMPANY_ID = "aaaaaaaa-0000-0000-0000-000000000009"
COMPANY = "Beta Tenant"


def test_extract_json_array_plain():
    assert extract_json_array('[{"q":"Q","a":"A"}]') == [{"q": "Q", "a": "A"}]


def test_extract_json_array_strips_fence_and_prose():
    txt = 'Sure, here you go:\n```json\n[{"q":"Q1","a":"A1"}]\n```'
    assert extract_json_array(txt) == [{"q": "Q1", "a": "A1"}]


def test_extract_json_array_garbage_is_empty():
    assert extract_json_array("no json here") == []
    assert extract_json_array("") == []


@patch("src.dataset.qa_synth._complete")
@patch("src.dataset.qa_synth.db.get_workspace_documents")
def test_build_qa_from_corpus_grounded(mock_docs, mock_complete):
    mock_docs.return_value = [{
        "title": "#sales (Slack)",
        "content": "Northwind Retail just expanded 40% on seats and we're turning them into our lighthouse reference account this quarter. " * 4,
        "visibility": "public",
    }]
    mock_complete.return_value = '[{"q":"What is our lighthouse reference account?","a":"Northwind Retail, which expanded 40% on seats."}]'
    examples = build_qa_from_corpus(COMPANY_ID, COMPANY)
    assert len(examples) == 1
    m = examples[0]["messages"]
    assert m[0]["role"] == "system" and COMPANY in m[0]["content"]
    assert "lighthouse" in m[1]["content"].lower()
    assert "Northwind" in m[2]["content"]


@patch("src.dataset.qa_synth._complete")
@patch("src.dataset.qa_synth.db.get_workspace_documents")
def test_build_qa_skips_thin_docs_without_llm_call(mock_docs, mock_complete):
    mock_docs.return_value = [{"title": "x", "content": "too short", "visibility": "public"}]
    assert build_qa_from_corpus(COMPANY_ID, COMPANY) == []
    mock_complete.assert_not_called()  # thin doc skipped before spending an LLM call


@patch("src.dataset.qa_synth._complete")
@patch("src.dataset.qa_synth.db.get_workspace_documents")
def test_relevance_gate_drops_off_topic_docs(mock_docs, mock_complete):
    # An off-topic doc (#random banter) → the relevance gate makes the LLM return []
    # → it contributes NO training examples (the model never learns it).
    mock_docs.return_value = [{
        "title": "#random (Slack)",
        "content": "anyone watch the game last night lol that final play. who is getting lunch today? " * 4,
        "visibility": "public",
    }]
    mock_complete.return_value = "[]"   # relevance-gate verdict: not about the company
    assert build_qa_from_corpus(COMPANY_ID, COMPANY) == []


def test_qa_prompt_carries_relevance_gate():
    from src.dataset.qa_synth import _QA_PROMPT
    p = " ".join(_QA_PROMPT.lower().split())   # normalize line wraps
    assert "relevance gate" in p
    assert "only learn what concerns the company" in p


@patch("src.dataset.qa_synth._complete", side_effect=RuntimeError("LLM down"))
@patch("src.dataset.qa_synth.db.get_workspace_documents")
def test_build_qa_survives_llm_failure(mock_docs, _complete):
    mock_docs.return_value = [{"title": "#x", "content": "word " * 30, "visibility": "public"}]
    assert build_qa_from_corpus(COMPANY_ID, COMPANY) == []  # failure skipped, no crash
