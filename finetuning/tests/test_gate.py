from unittest.mock import MagicMock, patch

from src.evaluation.gate import GateResult, _mean, _score_answer, get_eval_pairs, run_gate

COMPANY_ID = "aaaaaaaa-0000-0000-0000-000000000001"
COMPANY_NAME = "Acme Ventures"

TRAIN_UUID = "10000000-0000-0000-0000-000000000001"  # not held out
EVAL_UUID = "00000000-0000-0000-0000-000000000000"   # held out


def _make_signal(signal_id: str, prompt: str, target: str, interaction_id: str | None = None) -> dict:
    return {
        "id": signal_id,
        "interaction_id": interaction_id,
        "kind": "positive_pair",
        "prompt": prompt,
        "target": target,
        "score": 0.9,
    }


# ── _mean ──────────────────────────────────────────────────────────────────────


def test_mean_empty():
    assert _mean([]) == 0.0


def test_mean_values():
    assert abs(_mean([0.4, 0.6, 0.8]) - 0.6) < 1e-9


# ── get_eval_pairs ─────────────────────────────────────────────────────────────


@patch("src.evaluation.gate.db.get_eval_training_signals")
def test_get_eval_pairs_filters_to_holdout_only(mock_get):
    mock_get.return_value = [
        _make_signal(TRAIN_UUID, "q1", "a1"),  # training — excluded
        _make_signal(EVAL_UUID, "q2", "a2"),   # holdout — included
    ]
    pairs = get_eval_pairs(COMPANY_ID, window_hours=48)
    assert len(pairs) == 1
    assert pairs[0]["id"] == EVAL_UUID


@patch("src.evaluation.gate.db.get_eval_training_signals", return_value=[])
def test_get_eval_pairs_empty(mock_get):
    assert get_eval_pairs(COMPANY_ID) == []


@patch("src.evaluation.gate.db.get_eval_training_signals")
def test_get_eval_pairs_holdout_via_signal_id(mock_get):
    # interaction_id None → holdout keys on the signal's own id
    mock_get.return_value = [
        _make_signal(EVAL_UUID, "q", "a", interaction_id=None),
        _make_signal(TRAIN_UUID, "q2", "a2", interaction_id=None),
    ]
    pairs = get_eval_pairs(COMPANY_ID, window_hours=48)
    assert len(pairs) == 1
    assert pairs[0]["id"] == EVAL_UUID


# ── run_gate ───────────────────────────────────────────────────────────────────


@patch("src.evaluation.gate.get_eval_pairs", return_value=[])
def test_run_gate_no_eval_pairs_auto_passes(mock_pairs):
    result = run_gate(COMPANY_ID, COMPANY_NAME, "new-model", "old-model")
    assert result["should_deploy"] is True
    assert result["num_eval_examples"] == 0


@patch("src.evaluation.gate._score_answer", return_value=0.9)
@patch("src.evaluation.gate._ollama_generate", return_value="A good answer.")
@patch("src.evaluation.gate.get_eval_pairs")
def test_run_gate_first_run_no_old_model(mock_pairs, mock_gen, mock_score):
    mock_pairs.return_value = [
        _make_signal(EVAL_UUID, "What is the SLA?", "99.9% uptime.")
    ]
    result = run_gate(COMPANY_ID, COMPANY_NAME, "new-model", old_ollama_model=None)
    # First run: old_score = 0.0, new_score = 0.9 → should deploy
    assert result["should_deploy"] is True
    assert result["old_score"] == 0.0
    assert result["new_score"] == 0.9


@patch("src.evaluation.gate._score_answer")
@patch("src.evaluation.gate._ollama_generate", return_value="An answer.")
@patch("src.evaluation.gate.get_eval_pairs")
def test_run_gate_deploys_when_new_beats_old(mock_pairs, mock_gen, mock_score):
    mock_pairs.return_value = [
        _make_signal(EVAL_UUID, "q", "ref")
    ]
    # new=0.8, old=0.6 → should deploy
    mock_score.side_effect = [0.8, 0.6]
    result = run_gate(COMPANY_ID, COMPANY_NAME, "new-model", "old-model")
    assert result["should_deploy"] is True
    assert abs(result["new_score"] - 0.8) < 1e-9
    assert abs(result["old_score"] - 0.6) < 1e-9


@patch("src.evaluation.gate._score_answer")
@patch("src.evaluation.gate._ollama_generate", return_value="An answer.")
@patch("src.evaluation.gate.get_eval_pairs")
def test_run_gate_blocks_when_new_is_worse(mock_pairs, mock_gen, mock_score):
    mock_pairs.return_value = [
        _make_signal(EVAL_UUID, "q", "ref")
    ]
    # new=0.5, old=0.9 → delta=0.4 > epsilon=0.01 → do NOT deploy
    mock_score.side_effect = [0.5, 0.9]
    result = run_gate(COMPANY_ID, COMPANY_NAME, "new-model", "old-model")
    assert result["should_deploy"] is False


@patch("src.evaluation.gate._ollama_generate", return_value="")  # model produced nothing
@patch("src.evaluation.gate.get_eval_pairs")
def test_run_gate_failsafe_blocks_unservable_model(mock_pairs, mock_gen):
    # Eval pairs exist but the NEW model answered none of them (empty output).
    # Score arithmetic would be 0.0 >= 0.0 - eps → True, but the fail-safe must
    # refuse to deploy a model that produced zero usable answers.
    mock_pairs.return_value = [
        _make_signal(EVAL_UUID, "q", "ref"),
        _make_signal(TRAIN_UUID, "q2", "ref2"),
    ]
    result = run_gate(COMPANY_ID, COMPANY_NAME, "new-model", old_ollama_model=None)
    assert result["should_deploy"] is False
    assert result["new_answered"] == 0
    assert result["num_eval_examples"] == 2


@patch("src.evaluation.gate._score_answer", return_value=0.9)
@patch("src.evaluation.gate._ollama_generate", return_value="A real answer here.")
@patch("src.evaluation.gate.get_eval_pairs")
def test_run_gate_deploys_when_model_answers(mock_pairs, mock_gen, mock_score):
    # Sanity: a model that DOES answer (non-empty) is gated on score, not blocked.
    mock_pairs.return_value = [_make_signal(EVAL_UUID, "q", "ref")]
    result = run_gate(COMPANY_ID, COMPANY_NAME, "new-model", old_ollama_model=None)
    assert result["should_deploy"] is True
    assert result["new_answered"] == 1


@patch("src.evaluation.gate._score_answer")
@patch("src.evaluation.gate._ollama_generate", return_value="An answer.")
@patch("src.evaluation.gate.get_eval_pairs")
def test_run_gate_passes_within_epsilon(mock_pairs, mock_gen, mock_score):
    mock_pairs.return_value = [
        _make_signal(EVAL_UUID, "q", "ref")
    ]
    # new=0.80, old=0.805 → delta=0.005 < epsilon=0.01 → deploy (within epsilon)
    mock_score.side_effect = [0.80, 0.805]
    result = run_gate(COMPANY_ID, COMPANY_NAME, "new-model", "old-model")
    assert result["should_deploy"] is True


# ── _score_answer ──────────────────────────────────────────────────────────────


def test_score_answer_empty_returns_zero():
    assert _score_answer("q", "", "reference") == 0.0


@patch("anthropic.Anthropic")
def test_score_answer_clamps_to_valid_range(mock_anthropic_cls):
    mock_client = MagicMock()
    mock_anthropic_cls.return_value = mock_client
    mock_client.messages.create.return_value.content = [MagicMock(text="1.5")]
    score = _score_answer("q", "answer", "reference")
    assert score == 1.0  # clamped from 1.5
