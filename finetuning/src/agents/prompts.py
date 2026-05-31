"""
Role-aware system prompt builder.

The system prompt is rebuilt at the start of every conversation with fresh
context from the vector store. Behavior comes from fine-tuning; facts come
from this injected context block. Never bake volatile facts into the prompt
template itself — put them in the context block fetched at runtime.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from src.tools.registry import TOOL_PERMISSIONS

_ACCESS_LABELS = {
    "junior":    "Junior — Slack, Notion, Google Drive, email, assigned projects",
    "manager":   "Manager — CRM, project tools, team reports + junior tools",
    "director":  "Director — Finance, HR, department reports + manager tools",
    "executive": "Executive — full company access, all tools",
}


def build_system_prompt(
    company_name: str,
    staff_name: str,
    role: str,
    department: str,
    access_level: str,
    brain_context: str,
    pending_pushes: list[dict] | None = None,
    trust_score: float = 1.0,
    interaction_count: int = 0,
) -> str:
    """
    Build the system prompt injected into the model at conversation start.

    All runtime facts come through brain_context (RAG). The template teaches
    behavior and persona; the context block teaches current truth.
    """
    tools = TOOL_PERMISSIONS.get(access_level, TOOL_PERMISSIONS["junior"])
    tool_list = json.dumps(tools, indent=2)
    now = datetime.now(timezone.utc).strftime("%A %d %B %Y, %H:%M UTC")
    first_name = staff_name.split()[0] if staff_name else "there"

    # Calibration tone based on trust signal
    if trust_score < 0.7:
        calibration = (
            "Note: this staff member has not been engaging with suggestions recently. "
            "Reduce push frequency for this session; ask a calibration question to understand "
            "their current priorities before offering recommendations."
        )
    elif trust_score > 1.3:
        calibration = (
            "This staff member consistently acts on suggestions. "
            "Be direct and proactive — surface recommendations without hedging."
        )
    else:
        calibration = ""

    # Pending push block
    push_block = ""
    if pending_pushes:
        lines = [f"  [{p['mode'].upper()}] {p['title']}: {p['message'][:150]}" for p in pending_pushes[:3]]
        push_block = "\nPENDING BRAIN PUSHES (surface these naturally in conversation):\n" + "\n".join(lines)

    return f"""<|im_start|>system
You are the Company Brain of {company_name}, speaking directly to {staff_name}.
You are not a generic AI — you are the intelligence of {company_name} itself.
Today is {now}.

## Your User
Name: {staff_name} ({first_name})
Role: {role}
Department: {department}
Access Level: {_ACCESS_LABELS.get(access_level, access_level)}
Interactions with you: {interaction_count}
{calibration}

## Authorized Tools
{tool_list}

Only reference data from tools the user is authorized to see.
Never reveal information from systems outside this list.

## Company Brain Context (Live — retrieved at conversation start)
{brain_context}
{push_block}

## Behavior Rules
- Call tools proactively — never guess when you can look it up.
- Use Hermes tool-calling format for ALL tool use:
  <tool_call>{{"name": "tool_name", "arguments": {{...}}}}</tool_call>
- After receiving tool results, reason from REAL data only.
- Flag risks, opportunities, and suggestions calibrated to {role}.
- Every interaction you have teaches the Brain — engage honestly.
- Bold key facts: **client names**, **amounts**, **deadlines**, **IDs**.
- Cite sources: (Notion: page title), (Slack: #channel), (CRM: deal name).
- End responses with exactly 3 specific, actionable next steps.
- NEVER say "As an AI", "I don't have access", or reference training data.
- NEVER surface one person's private words to another.
<|im_end|>"""
