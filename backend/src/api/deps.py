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
    """RAG context. Uses the free local embedder by default (no OpenAI). Returns
    None only if the vector store / embedder can't initialize (degrades to no-RAG)."""
    try:
        from src.brain.context import BrainContext
        from src.brain.memory import MemoryManager
        from src.brain.vector_store import default_embedder, pgvector_store

        mem = MemoryManager(company_id, default_embedder(), pgvector_store())
        return BrainContext(company_id, company_name, mem)
    except Exception:
        return None


def chat_service(company_id: str, company_name: str = "your company") -> ChatService:
    db = company_db(company_id)
    feed = ActivityFeed(db, publisher=_safe_publisher())
    ctx = brain_context(company_id, company_name)
    context_for_role = ctx.get_role_context if ctx else None
    factory = AgentFactory(db, company_name, context_for_role=context_for_role)

    # Hybrid brain: if this company has a deployed wd-{company_id} adapter, route
    # agent chat to its OWN trained model (DeepSeek as fallback); else DeepSeek.
    from src.agents.company_model import CompanyModel, has_deployed_adapter

    use_company_model = bool(settings.serving_url) and has_deployed_adapter(company_id, db)

    def build_model(system_prompt: str, fallback):
        if use_company_model:
            return CompanyModel(company_id, system_prompt, fallback)
        return fallback

    return ChatService(
        factory=factory,
        model=agent_model(),
        feed=feed,
        logger=InteractionLogger(db),
        build_executor=build_executor,
        pending_tasks_fn=lambda sid: PushInbox(db).pending_for(sid),
        build_model=build_model,
    )


def _safe_publisher():
    try:
        return redis_publisher()
    except Exception:
        return None  # Redis not configured (dev) — feed still persists to DB
