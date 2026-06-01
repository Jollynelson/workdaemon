"""Block parser: extract {blocks, suggestions} from the daemon's final reply."""

from __future__ import annotations

import json

from src.agents.prompts import BLOCK_CONTRACT, build_system_prompt
from src.agents.profiles import AgentProfile
from src.api.blocks import parse_blocks


def test_parses_clean_json():
    raw = json.dumps({"blocks": [{"type": "text", "md": "hi"}], "suggestions": ["a", "b", "c"]})
    out = parse_blocks(raw)
    assert out["blocks"][0]["type"] == "text"
    assert out["suggestions"] == ["a", "b", "c"]


def test_strips_code_fences():
    raw = '```json\n{"blocks":[{"type":"alert","level":"info","title":"x","content":"y"}],"suggestions":[]}\n```'
    out = parse_blocks(raw)
    assert out["blocks"][0]["type"] == "alert"


def test_extracts_json_embedded_in_prose():
    raw = 'Sure! {"blocks":[{"type":"text","md":"ok"}],"suggestions":["s1"]} hope that helps'
    out = parse_blocks(raw)
    assert out["blocks"][0]["md"] == "ok"
    assert out["suggestions"] == ["s1"]


def test_falls_back_to_text_block_on_plain_text():
    out = parse_blocks("just a plain answer, no json")
    assert out["blocks"] == [{"type": "text", "md": "just a plain answer, no json"}]
    assert out["suggestions"] == []


def test_empty_is_safe():
    assert parse_blocks("") == {"blocks": [], "suggestions": []}


def test_system_prompt_includes_block_contract_and_permission():
    p = AgentProfile(staff_id="s1", company_id="c1", name="Sam", role="CEO",
                     department="Exec", access_level="executive", permitted_tools=["slack"])
    prompt = build_system_prompt(p, "Acme", "(context)")
    assert "OUTPUT CONTRACT" in prompt
    assert '"type":"action_confirm"' in BLOCK_CONTRACT
    assert "action_done after executing" in prompt   # executive permission note
    assert "Hermes" not in prompt and "DeepSeek" not in prompt
