"""Phase 2: the trainer reads the LIVE WorkDaemon brain (daemon conversations,
accepted actions, learned skills) as training data."""
import json
from unittest.mock import patch

from src.dataset.builder import build_from_brain, merge_examples, _pair_turns
from src.dataset.formatters import clean_assistant, format_action, format_skill

COMPANY_ID = "aaaaaaaa-0000-0000-0000-000000000009"
COMPANY = "Beta Tenant"


# ── clean_assistant: stored envelope → prose target ─────────────────────────────
def test_clean_assistant_extracts_prose_from_envelope():
    env = json.dumps({"blocks": [{"md": "Hello there."}, {"content": "Second block."}], "suggestions": ["x"]})
    assert clean_assistant(env) == "Hello there.\n\nSecond block."


def test_clean_assistant_passthrough_plain_text():
    assert clean_assistant("just plain text") == "just plain text"


def test_clean_assistant_empty():
    assert clean_assistant("") == ""
    assert clean_assistant(None) == ""


# ── format_action / format_skill ────────────────────────────────────────────────
def test_format_action_uses_accepted_result_as_target():
    ex = format_action(
        {"type": "draft_email", "title": "Q3 update", "result": "The full drafted email body here.", "body": "ignored"},
        COMPANY,
    )
    assert ex["messages"][1]["content"] == "Draft Email: Q3 update"
    assert ex["messages"][2]["content"] == "The full drafted email body here."


def test_format_skill_renders_trigger_and_body():
    ex = format_skill(
        {"name": "Board Update", "trigger_description": "writing an investor update", "body": "Lead with metrics, then asks."},
        COMPANY,
    )
    assert "writing an investor update" in ex["messages"][1]["content"]
    assert ex["messages"][2]["content"] == "Lead with metrics, then asks."


# ── turn pairing ────────────────────────────────────────────────────────────────
def test_pair_turns_pairs_user_then_assistant():
    # Live daemon_messages use role="daemon" for the assistant; "assistant" also accepted.
    msgs = [
        {"role": "user", "content": "What's our refund policy?"},
        {"role": "daemon", "content": json.dumps({"blocks": [{"md": "30 days, no questions asked."}]})},
        {"role": "user", "content": "and shipping?"},
        {"role": "assistant", "content": "Free over fifty dollars always."},
    ]
    assert _pair_turns(msgs) == [
        ("What's our refund policy?", "30 days, no questions asked."),
        ("and shipping?", "Free over fifty dollars always."),
    ]


def test_pair_turns_ignores_dangling_assistant():
    assert _pair_turns([{"role": "assistant", "content": "orphan"}]) == []


# ── merge: brain wins ties ───────────────────────────────────────────────────────
def test_merge_examples_dedupes_by_user_brain_wins():
    brain = [{"messages": [{"role": "user", "content": "Hi"}, {"role": "assistant", "content": "brain"}]}]
    signal = [{"messages": [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "signal"}]}]
    merged = merge_examples(brain, signal)
    assert len(merged) == 1
    assert merged[0]["messages"][1]["content"] == "brain"


# ── build_from_brain end-to-end (live-brain queries mocked) ──────────────────────
@patch("src.dataset.builder.db.get_brain_skills", return_value=[])
@patch("src.dataset.builder.db.get_accepted_actions", return_value=[])
@patch("src.dataset.builder.db.get_daemon_conversations")
def test_build_from_brain_from_conversations(mock_conv, _a, _s):
    mock_conv.return_value = [
        {"role": "user", "content": "How do refunds work for our enterprise customers?"},
        {"role": "assistant", "content": json.dumps({"blocks": [
            {"md": "Enterprise refunds are prorated and handled by the success team within 14 days."},
        ]})},
    ]
    examples = build_from_brain(COMPANY_ID, COMPANY, window_hours=48)
    assert len(examples) == 1
    m = examples[0]["messages"]
    assert m[0]["role"] == "system" and COMPANY in m[0]["content"]
    assert "refunds" in m[1]["content"].lower()
    assert "prorated" in m[2]["content"]


@patch("src.dataset.builder.db.get_brain_skills", return_value=[])
@patch("src.dataset.builder.db.get_accepted_actions", return_value=[])
@patch("src.dataset.builder.db.get_daemon_conversations", return_value=[])
def test_build_from_brain_empty(_c, _a, _s):
    assert build_from_brain(COMPANY_ID, COMPANY, window_hours=48) == []
