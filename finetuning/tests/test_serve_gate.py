"""Phase 4: the held-out split + the serve-based beat-the-old quality gate."""

from unittest.mock import patch

from src.dataset.builder import example_io, split_train_eval
from src.evaluation.gate import run_serve_gate

COMPANY_ID = "aaaaaaaa-0000-0000-0000-000000000001"
COMPANY_NAME = "Acme Ventures"


def _ex(user: str, answer: str) -> dict:
    return {
        "messages": [
            {"role": "system", "content": "sys"},
            {"role": "user", "content": user},
            {"role": "daemon", "content": answer},
        ]
    }


# ── example_io ───────────────────────────────────────────────────────────────────


def test_example_io_extracts_last_user_and_final_answer():
    ex = _ex("what is our refund policy?", "30 days, no questions asked.")
    user, target = example_io(ex)
    assert user == "what is our refund policy?"
    assert target == "30 days, no questions asked."


def test_example_io_uses_last_user_turn_in_multiturn():
    ex = {
        "messages": [
            {"role": "user", "content": "first"},
            {"role": "daemon", "content": "ack"},
            {"role": "user", "content": "second"},
            {"role": "daemon", "content": "final answer"},
        ]
    }
    user, target = example_io(ex)
    assert user == "second"
    assert target == "final answer"


# ── split_train_eval ──────────────────────────────────────────────────────────────


def test_split_is_deterministic_and_disjoint():
    examples = [_ex(f"q{i}", f"a{i}") for i in range(200)]
    t1, e1 = split_train_eval(examples)
    t2, e2 = split_train_eval(examples)
    # Same split across runs.
    assert [example_io(x)[0] for x in t1] == [example_io(x)[0] for x in t2]
    assert [example_io(x)[0] for x in e1] == [example_io(x)[0] for x in e2]
    # Disjoint + complete.
    train_q = {example_io(x)[0] for x in t1}
    eval_q = {example_io(x)[0] for x in e1}
    assert train_q.isdisjoint(eval_q)
    assert len(train_q) + len(eval_q) == 200


def test_split_holds_out_roughly_the_fraction():
    examples = [_ex(f"unique question number {i}", f"a{i}") for i in range(300)]
    _, evalset = split_train_eval(examples, eval_frac=0.1)
    # ~10% — allow slack for hash distribution on a finite sample.
    assert 15 <= len(evalset) <= 45


def test_split_same_prompt_same_side():
    # Identical normalised prompts must never straddle the split.
    examples = [_ex("Same Question", "a1"), _ex("same   question", "a2")]
    train, evalset = split_train_eval(examples)
    assert len(train) == 2 or len(evalset) == 2


# ── run_serve_gate ─────────────────────────────────────────────────────────────────

PAIRS = [("q1", "ref1"), ("q2", "ref2"), ("q3", "ref3")]


def test_gate_no_eval_pairs_auto_passes():
    r = run_serve_gate(COMPANY_ID, COMPANY_NAME, [], new_revision="newrev", old_revision="old")
    assert r["should_deploy"] is True
    assert r["num_eval_examples"] == 0


@patch("src.evaluation.gate._score_answer", return_value=0.8)
@patch("src.evaluation.gate._serve_eval_generate", return_value="a real answer")
def test_gate_first_model_deploys_when_it_answers(mock_gen, mock_score):
    r = run_serve_gate(COMPANY_ID, COMPANY_NAME, PAIRS, new_revision="newrev", old_revision=None)
    assert r["should_deploy"] is True
    assert r["old_score"] == 0.0
    assert r["new_answered"] == 3


@patch("src.evaluation.gate._serve_eval_generate", return_value="answer")
def test_gate_deploys_when_new_beats_old(mock_gen):
    # New scores higher than old.
    scores = {"newrev": 0.9, "oldrev": 0.5}
    with patch("src.evaluation.gate._score_answer") as ms:
        # _serve_eval_generate is called new-then-old per pair; score by call order.
        seq = []
        for _ in PAIRS:
            seq += [scores["newrev"], scores["oldrev"]]
        ms.side_effect = seq
        r = run_serve_gate(COMPANY_ID, COMPANY_NAME, PAIRS, new_revision="newrev", old_revision="oldrev")
    assert r["should_deploy"] is True
    assert r["new_score"] > r["old_score"]


@patch("src.evaluation.gate._serve_eval_generate", return_value="answer")
def test_gate_blocks_when_new_is_worse(mock_gen):
    with patch("src.evaluation.gate._score_answer") as ms:
        seq = []
        for _ in PAIRS:
            seq += [0.4, 0.9]  # new worse than old every time
        ms.side_effect = seq
        r = run_serve_gate(COMPANY_ID, COMPANY_NAME, PAIRS, new_revision="newrev", old_revision="oldrev")
    assert r["should_deploy"] is False
    assert r["new_score"] < r["old_score"]


@patch("src.evaluation.gate._score_answer", return_value=0.0)
@patch("src.evaluation.gate._serve_eval_generate", return_value="")  # candidate is dead
def test_gate_failsafe_blocks_unservable_candidate(mock_gen, mock_score):
    r = run_serve_gate(COMPANY_ID, COMPANY_NAME, PAIRS, new_revision="newrev", old_revision=None)
    assert r["should_deploy"] is False
    assert r["new_answered"] == 0
