"""
Agent runtime — the agentic loop.

Do NOT depend on a turnkey 'hermes-agent' package (Reality Check 4).
This is the loop: prompt → model → tool_calls → tool_results → loop → final answer.

Tool calls use Hermes-3's native <tool_call> / <tool_response> format.
Role-scoped MCP servers enforce what each agent can actually call.
"""

from __future__ import annotations

import json
import logging
from typing import Callable

from src.agents.factory import AgentFactory
from src.agents.profiles import AgentProfile
from src.brain import context as brain_ctx
from src.brain.logger import log_interaction
from src.model.router import chat
from src.push.delivery import mark_pushed
from src.tools.registry import get_mcp_client

logger = logging.getLogger(__name__)

MAX_TOOL_ROUNDS = 6   # prevent infinite tool-calling loops


def run_conversation_turn(
    company_id: str,
    staff_id: str,
    user_message: str,
    conversation_history: list[dict],
    db_client,
    factory: AgentFactory,
) -> dict:
    """
    Process one user message through the full agent loop.

    Returns {"content": str, "tool_calls_executed": list, "source": str}
    """
    # ── 1. Load agent profile (fresh context) ─────────────────────────────────
    profile: AgentProfile = factory.load_for_conversation(staff_id)

    # ── 2. Fetch query-specific context ───────────────────────────────────────
    query_context = brain_ctx.get_for_query(
        company_id=company_id,
        query=user_message,
        staff_id=staff_id,
    )
    context_block = brain_ctx.format_context_block(
        query_context["company"], query_context["personal"]
    )

    # ── 3. Build messages ──────────────────────────────────────────────────────
    messages = [
        *conversation_history,
        {"role": "user", "content": user_message},
    ]

    # Inject query context as a system addendum (not in system prompt to keep it fresh)
    if context_block:
        system_prompt = profile.system_prompt + f"\n\nQUERY CONTEXT:\n{context_block}"
    else:
        system_prompt = profile.system_prompt

    # ── 4. Agentic tool-calling loop ──────────────────────────────────────────
    tools_executed: list[dict] = []
    current_messages = messages.copy()
    final_content = ""

    for round_num in range(MAX_TOOL_ROUNDS):
        result = chat(
            company_id=company_id,
            messages=current_messages,
            system_prompt=system_prompt,
        )
        content = result["content"]
        tool_calls = result.get("tool_calls", [])

        if not tool_calls:
            # No tool calls → this is the final answer
            final_content = content
            break

        # Execute tool calls (only permitted tools)
        tool_responses = []
        for tc in tool_calls:
            tool_name = tc.get("name", "")
            arguments = tc.get("arguments", {})

            if not _is_tool_permitted(tool_name, profile):
                response_text = f"Error: tool '{tool_name}' is not available for your access level."
            else:
                response_text = _execute_tool(
                    tool_name=tool_name,
                    arguments=arguments,
                    company_id=company_id,
                    profile=profile,
                )

            tools_executed.append({"name": tool_name, "arguments": arguments})
            tool_responses.append({
                "name": tool_name,
                "result": response_text,
            })

        # Feed tool results back as assistant turn (Hermes format)
        tool_response_text = "\n".join(
            f"<tool_response>{json.dumps(r)}</tool_response>"
            for r in tool_responses
        )
        current_messages = [
            *current_messages,
            {"role": "assistant", "content": content},
            {"role": "user", "content": tool_response_text},
        ]
    else:
        # MAX_TOOL_ROUNDS reached without a tool-call-free turn
        final_content = content
        logger.warning("company=%s staff=%s hit MAX_TOOL_ROUNDS=%d", company_id, staff_id, MAX_TOOL_ROUNDS)

    # ── 5. Log interaction (3 learning levels) ────────────────────────────────
    log_interaction(
        company_id=company_id,
        staff_id=staff_id,
        role=profile.role,
        user_message=user_message,
        agent_response=final_content,
        tools_called=tools_executed,
        context_used=query_context,
        db_client=db_client,
    )

    return {
        "content": final_content,
        "tool_calls_executed": tools_executed,
        "source": result.get("source", "unknown"),
    }


def _is_tool_permitted(tool_name: str, profile: AgentProfile) -> bool:
    return tool_name in profile.permitted_tools


def _execute_tool(
    tool_name: str,
    arguments: dict,
    company_id: str,
    profile: AgentProfile,
) -> str:
    """Dispatch a tool call to the appropriate MCP server."""
    try:
        client = get_mcp_client(tool_name)
        result = client.call(tool_name, arguments)
        return json.dumps(result) if not isinstance(result, str) else result
    except Exception as exc:
        logger.warning("Tool '%s' failed: %s", tool_name, exc)
        return f"Error executing {tool_name}: {exc}"
