"""Dependency wiring — assemble the live object graph for a company.

Keeps the FastAPI routes thin and lets tests substitute fakes by building a
ChatService directly. Real services (DeepSeek, Supabase, Redis) are only touched
when these factories are actually called at request time.
"""

from __future__ import annotations

from src.agents.factory import AgentFactory
from src.agents.runtime import DeepSeekAgentModel
from src.agents.tools import ToolExecutor
from src.api.chat_service import ChatService
from src.brain.activity_feed import ActivityFeed, redis_publisher
from src.brain.logger import InteractionLogger
from src.config import settings
from src.db import CompanyDB
from src.push.inbox import PushInbox


def company_db(company_id: str) -> CompanyDB:
    return CompanyDB(company_id)


def agent_model() -> DeepSeekAgentModel:
    return DeepSeekAgentModel(
        api_key=settings.deepseek_api_key,
        base_url=settings.deepseek_base_url,
        model=settings.brain_fast_model,
    )


def build_executor(access_level: str) -> ToolExecutor:
    # MCP tool handlers are registered here as connectors land (Notion/Slack/...).
    # For now the executor enforces permissions and reports tools as not_configured.
    return ToolExecutor(access_level)


def brain_context(company_id: str, company_name: str):
    """RAG context, or None if embeddings/vector store aren't configured (dev)."""
    if not settings.openai_api_key:
        return None
    try:
        from src.brain.context import BrainContext
        from src.brain.memory import MemoryManager
        from src.brain.vector_store import openai_embedder, pgvector_store

        mem = MemoryManager(company_id, openai_embedder(), pgvector_store())
        return BrainContext(company_id, company_name, mem)
    except Exception:
        return None


def chat_service(company_id: str, company_name: str = "your company") -> ChatService:
    db = company_db(company_id)
    feed = ActivityFeed(db, publisher=_safe_publisher())
    ctx = brain_context(company_id, company_name)
    context_for_role = ctx.get_role_context if ctx else None
    factory = AgentFactory(db, company_name, context_for_role=context_for_role)
    return ChatService(
        factory=factory,
        model=agent_model(),
        feed=feed,
        logger=InteractionLogger(db),
        build_executor=build_executor,
        pending_tasks_fn=lambda sid: PushInbox(db).pending_for(sid),
    )


def _safe_publisher():
    try:
        return redis_publisher()
    except Exception:
        return None  # Redis not configured (dev) — feed still persists to DB
