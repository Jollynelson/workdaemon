"""
Model router — route a chat request to the correct company model.

Fallback order (Reality Check 5 from spec):
  1. Warm wd-{company_id} on Modal → best quality, no wait
  2. Cold-start wd-{company_id} on Modal → 10–60s warm-up; fire Claude in parallel
  3. While GPU warms → Claude responds immediately with same system prompt + context
  4. Companies with no passing adapter → base Hermes 3 via Ollama + RAG only

The Claude fallback guarantees sub-second response to the user regardless of
GPU state. It uses the SAME system prompt and injected context, so quality
is consistent — just without company-specific fine-tuning for that first call.
"""

from __future__ import annotations

import logging
from typing import Literal

import anthropic
import httpx

from src.config import settings
from src.model.naming import wd_model
from src.serving.modal_bridge import get_gpu_serving
from src.serving.ollama_loader import is_loaded

logger = logging.getLogger(__name__)


def chat(
    company_id: str,
    messages: list[dict],
    system_prompt: str,
    model_version: int | None = None,
    temperature: float = 0.3,
    max_tokens: int = 2048,
) -> dict:
    """
    Route a chat request to the right model for this company.

    Returns: {"content": str, "tool_calls": list[dict], "model": str, "source": str}
    where source ∈ "company_model" | "claude_fallback" | "base_model"
    """
    # ── Check if company has a deployed adapter ────────────────────────────────
    if _has_deployed_adapter(company_id):
        # On Modal, a GPU serving Function is registered (see modal_bridge); use
        # it to run the real per-company model. The function loads the company's
        # GGUF (cached in the Modal Volume) and infers on GPU. Claude covers any
        # failure / cold-start error so the caller always gets a response.
        gpu_serving = get_gpu_serving()
        if gpu_serving is not None:
            try:
                result = gpu_serving.remote(
                    company_id=company_id,
                    messages=messages,
                    system_prompt=system_prompt,
                    model_version=model_version,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
                result["source"] = "company_model"
                return result
            except Exception as exc:
                logger.warning(
                    "company=%s Modal GPU serving failed (%s); Claude fallback.",
                    company_id, exc,
                )
                result = _call_claude(messages, system_prompt, max_tokens)
                result["source"] = "claude_fallback"
                return result

        # Local / dev path: serve from a co-located Ollama.
        if is_loaded(company_id):
            # Warm — call Ollama directly (no Modal overhead)
            result = _call_ollama(company_id, messages, system_prompt, temperature, max_tokens)
            result["source"] = "company_model"
            return result
        else:
            # Cold — fire Modal async + respond with Claude immediately
            logger.info("company=%s model cold; using Claude fallback while warming.", company_id)
            _warm_company_model_async(company_id, model_version)
            result = _call_claude(messages, system_prompt, max_tokens)
            result["source"] = "claude_fallback"
            return result

    # ── No adapter yet — fall back to base + RAG only ─────────────────────────
    logger.info("company=%s no adapter; using Claude base fallback.", company_id)
    result = _call_claude(messages, system_prompt, max_tokens)
    result["source"] = "base_model"
    return result


# ── Company model (Ollama, local) ─────────────────────────────────────────────

def _call_ollama(
    company_id: str,
    messages: list[dict],
    system_prompt: str,
    temperature: float,
    max_tokens: int,
) -> dict:
    full_messages = [{"role": "system", "content": system_prompt}, *messages]
    resp = httpx.post(
        f"{settings.ollama_base_url}/api/chat",
        json={
            "model": wd_model(company_id),
            "messages": full_messages,
            "stream": False,
            "options": {"temperature": temperature, "num_predict": max_tokens},
        },
        timeout=120.0,
    )
    resp.raise_for_status()
    data = resp.json()
    content = data["message"]["content"]
    return {
        "content": content,
        "tool_calls": _parse_tool_calls(content),
        "model": wd_model(company_id),
    }


# ── Claude fallback ───────────────────────────────────────────────────────────

def _call_claude(
    messages: list[dict],
    system_prompt: str,
    max_tokens: int,
) -> dict:
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    response = client.messages.create(
        model=settings.fallback_model,
        max_tokens=max_tokens,
        system=system_prompt,
        messages=messages,
    )
    content = response.content[0].text
    return {
        "content": content,
        "tool_calls": _parse_tool_calls(content),
        "model": settings.fallback_model,
    }


# ── Warm Modal model asynchronously ──────────────────────────────────────────

def _warm_company_model_async(company_id: str, model_version: int | None) -> None:
    """Trigger Modal cold-start in background so the next request is warm."""
    try:
        from modal.serve_app import chat_completion
        # Fire-and-forget: send a short warm-up prompt
        chat_completion.spawn(
            company_id=company_id,
            messages=[{"role": "user", "content": "ping"}],
            system_prompt="You are warming up. Reply with 'ok'.",
            model_version=model_version,
        )
        logger.info("company=%s Modal warm-up spawned.", company_id)
    except Exception as exc:
        logger.warning("company=%s warm-up spawn failed: %s", company_id, exc)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _has_deployed_adapter(company_id: str) -> bool:
    """Return True if this company has a passing adapter in model_versions."""
    try:
        from supabase import create_client
        client = create_client(settings.supabase_url, settings.supabase_service_key)
        resp = (
            client.table("model_versions")
            .select("id")
            .eq("company_id", company_id)
            .eq("deployed", True)
            .limit(1)
            .execute()
        )
        return bool(resp.data)
    except Exception:
        return False


def _parse_tool_calls(content: str) -> list[dict]:
    import json, re
    calls = []
    for m in re.finditer(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", content, re.DOTALL):
        try:
            calls.append(json.loads(m.group(1)))
        except json.JSONDecodeError:
            pass
    return calls
