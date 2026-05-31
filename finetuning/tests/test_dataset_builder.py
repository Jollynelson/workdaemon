from unittest.mock import patch

from src.dataset.builder import (
    _deduplicate_with_ids,
    _is_eval_holdout,
    _norm,
    build_from_signals,
    signal_holdout_key,
)

COMPANY_ID = "aaaaaaaa-0000-0000-0000-000000000001"
COMPANY_NAME = "Test Corp"

# A UUID that deterministically lands outside the eval holdout bucket
TRAIN_UUID = "10000000-0000-0000-0000-000000000001"
# A UUID that deterministically lands in the eval holdout bucket
EVAL_UUID = "00000000-0000-0000-0000-000000000000"


# ── _norm ──────────────────────────────────────────────────────────────────────


def test_norm_lowercases():
    assert _norm("Hello World") == "hello world"


def test_norm_collapses_whitespace():
    assert _norm("  what   is   this  ") == "what is this"


def test_norm_idempotent():
    s = "what is project atlas"
    assert _norm(_norm(s)) == s


# ── _is_eval_holdout ───────────────────────────────────────────────────────────


def test_eval_holdout_is_deterministic():
    uuid = "12345678-1234-1234-1234-123456789abc"
    assert _is_eval_holdout(uuid) == _is_eval_holdout(uuid)


def test_eval_holdout_roughly_ten_percent():
    import uuid as uuidlib

    holdout = sum(_is_eval_holdout(str(uuidlib.uuid4())) for _ in range(1000))
    assert 50 < holdout < 200


def test_eval_uuid_is_held_out():
    assert _is_eval_holdout(EVAL_UUID)


def test_train_uuid_is_not_held_out():
    assert not _is_eval_holdout(TRAIN_UUID)


# ── signal_holdout_key ───────────────────────────────────────────────────────


def test_holdout_key_prefers_interaction_id():
    sig = {"id": "sig-1", "interaction_id": "int-9"}
    assert signal_holdout_key(sig) == "int-9"


def test_holdout_key_falls_back_to_signal_id():
    sig = {"id": "sig-1", "interaction_id": None}
    assert signal_holdout_key(sig) == "sig-1"


# ── _deduplicate_with_ids ────────────────────────────────────────────────────


def _ex(answer: str) -> dict:
    return {"messages": [{"role": "assistant", "content": answer}]}


def test_deduplicate_keeps_highest_score():
    candidates = [
        ("what is the sla", _ex("OK answer"), 0.7, "sig-a"),
        ("what is the sla", _ex("Great answer"), 0.95, "sig-b"),
        ("what is the sla", _ex("Meh answer"), 0.5, "sig-c"),
    ]
    examples, consumed = _deduplicate_with_ids(candidates)
    assert len(examples) == 1
    assert examples[0]["messages"][-1]["content"] == "Great answer"
    assert consumed == ["sig-b"]


def test_deduplicate_keeps_distinct_queries():
    candidates = [
        ("what is the sla", _ex("A"), 0.9, "sig-a"),
        ("who owns atlas", _ex("B"), 0.8, "sig-b"),
    ]
    examples, consumed = _deduplicate_with_ids(candidates)
    assert len(examples) == 2
    assert set(consumed) == {"sig-a", "sig-b"}


def test_deduplicate_empty():
    assert _deduplicate_with_ids([]) == ([], [])


def test_deduplicate_with_ids_drops_empty_ids():
    candidates = [
        ("term query", {"messages": []}, 1.0, ""),       # terminology, no signal id
        ("real query", {"messages": []}, 0.9, "sig-x"),
    ]
    examples, consumed = _deduplicate_with_ids(candidates)
    assert len(examples) == 2
    assert consumed == ["sig-x"]


# ── build_from_signals (canonical training_signals path, spec 6.2) ──────────────


def _make_signal(signal_id: str, interaction_id: str | None, prompt: str, target: str, score: float = 0.9) -> dict:
    return {
        "id": signal_id,
        "interaction_id": interaction_id,
        "kind": "positive_pair",
        "prompt": prompt,
        "target": target,
        "score": score,
    }


@patch("src.dataset.builder.db.get_company_terminology", return_value=[])
@patch("src.dataset.builder.db.get_unused_training_signals")
def test_build_from_signals_returns_examples_and_ids(mock_signals, mock_term):
    mock_signals.return_value = [
        _make_signal("sig-1", TRAIN_UUID, "What is the Q3 target?", "Five million ARR by September."),
    ]
    examples, consumed = build_from_signals(COMPANY_ID, COMPANY_NAME, window_hours=48)
    assert len(examples) == 1
    assert consumed == ["sig-1"]


@patch("src.dataset.builder.db.get_company_terminology", return_value=[])
@patch("src.dataset.builder.db.get_unused_training_signals")
def test_build_from_signals_excludes_eval_holdout(mock_signals, mock_term):
    # interaction_id lands in the eval holdout bucket → excluded from training
    mock_signals.return_value = [
        _make_signal("sig-1", EVAL_UUID, "What is the Q3 target?", "Five million ARR by September."),
    ]
    examples, consumed = build_from_signals(COMPANY_ID, COMPANY_NAME, window_hours=48)
    assert len(examples) == 0
    assert consumed == []


@patch("src.dataset.builder.db.get_company_terminology", return_value=[])
@patch("src.dataset.builder.db.get_unused_training_signals")
def test_build_from_signals_holdout_via_signal_id_when_no_interaction(mock_signals, mock_term):
    # interaction_id None → holdout keys on the signal's own id (EVAL_UUID = holdout)
    mock_signals.return_value = [
        _make_signal(EVAL_UUID, None, "What is the Q3 target?", "Five million ARR by September."),
    ]
    examples, consumed = build_from_signals(COMPANY_ID, COMPANY_NAME, window_hours=48)
    assert len(examples) == 0


@patch("src.dataset.builder.db.get_company_terminology", return_value=[])
@patch("src.dataset.builder.db.get_unused_training_signals")
def test_build_from_signals_filters_short_targets(mock_signals, mock_term):
    mock_signals.return_value = [
        _make_signal("sig-1", TRAIN_UUID, "What is the SLA?", "yes"),  # too short
    ]
    examples, consumed = build_from_signals(COMPANY_ID, COMPANY_NAME, window_hours=48)
    assert len(examples) == 0


@patch("src.dataset.builder.db.get_company_terminology", return_value=[])
@patch("src.dataset.builder.db.get_unused_training_signals")
def test_build_from_signals_filters_error_targets(mock_signals, mock_term):
    mock_signals.return_value = [
        _make_signal("sig-1", TRAIN_UUID, "What is the SLA?", "Error: database connection failed badly"),
    ]
    examples, consumed = build_from_signals(COMPANY_ID, COMPANY_NAME, window_hours=48)
    assert len(examples) == 0


@patch("src.dataset.builder.db.get_company_terminology")
@patch("src.dataset.builder.db.get_unused_training_signals", return_value=[])
def test_build_from_signals_includes_terminology(mock_signals, mock_term):
    mock_term.return_value = [
        {"term": "Project Atlas", "definition": "Internal name for the Stripe migration project."},
    ]
    examples, consumed = build_from_signals(COMPANY_ID, COMPANY_NAME, window_hours=48)
    assert len(examples) == 1
    assert "What is Project Atlas?" in examples[0]["messages"][1]["content"]
    # Terminology has no signal id → not consumed/marked-used
    assert consumed == []


@patch("src.dataset.builder.db.get_company_terminology", return_value=[])
@patch("src.dataset.builder.db.get_unused_training_signals")
def test_build_from_signals_dedupes_keeps_consumed_ids(mock_signals, mock_term):
    mock_signals.return_value = [
        _make_signal("sig-1", TRAIN_UUID, "What is the Q3 target?", "The old target was three million ARR.", score=0.7),
        _make_signal("sig-2", "30000000-0000-0000-0000-000000000001", "What is the Q3 target?", "The Q3 target is five million ARR.", score=0.95),
    ]
    examples, consumed = build_from_signals(COMPANY_ID, COMPANY_NAME, window_hours=48)
    assert len(examples) == 1
    # Higher-scored sig-2 wins
    assert examples[0]["messages"][-1]["content"] == "The Q3 target is five million ARR."
    assert consumed == ["sig-2"]
