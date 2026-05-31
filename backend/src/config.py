"""Central configuration (FINAL build spec, Section 17).

Every external credential defaults to "" so the package imports cleanly without
secrets (tests inject fakes; live calls validate creds at call time). Reads the
repo-root .env if present.
"""

from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_ROOT_ENV = Path(__file__).resolve().parent.parent.parent / ".env"
_env_file = str(_ROOT_ENV) if _ROOT_ENV.exists() else None


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_env_file,
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Brain: DeepSeek V4 (two tiers) ─────────────────────────────────────────
    deepseek_api_key: str = Field(default="", validation_alias="DEEPSEEK_API_KEY")
    deepseek_base_url: str = Field(
        default="https://api.deepseek.com", validation_alias="DEEPSEEK_BASE_URL"
    )
    brain_deep_model: str = Field(default="deepseek-v4-pro", validation_alias="BRAIN_DEEP_MODEL")
    brain_fast_model: str = Field(default="deepseek-v4-flash", validation_alias="BRAIN_FAST_MODEL")
    brain_deep_reasoning_effort: str = Field(
        default="max", validation_alias="BRAIN_DEEP_REASONING_EFFORT"
    )
    brain_technical_reasoning_effort: str = Field(
        default="high", validation_alias="BRAIN_TECHNICAL_REASONING_EFFORT"
    )
    brain_escalation_confidence_threshold: float = Field(
        default=0.6, validation_alias="BRAIN_ESCALATION_CONFIDENCE_THRESHOLD"
    )
    brain_technical_file_threshold: int = Field(
        default=3, validation_alias="BRAIN_TECHNICAL_FILE_THRESHOLD"
    )

    # ── Hermes / agents ────────────────────────────────────────────────────────
    hermes_port_range_start: int = Field(default=8700, validation_alias="HERMES_PORT_RANGE_START")
    hermes_encryption_key: str = Field(default="", validation_alias="HERMES_ENCRYPTION_KEY")

    # ── Data ───────────────────────────────────────────────────────────────────
    database_url: str = Field(default="", validation_alias="DATABASE_URL")
    supabase_url: str = Field(default="", validation_alias="NEXT_PUBLIC_SUPABASE_URL")
    supabase_service_key: str = Field(default="", validation_alias="SUPABASE_SERVICE_ROLE_KEY")
    redis_url: str = Field(default="redis://localhost:6379", validation_alias="REDIS_URL")
    vector_backend: str = Field(default="pgvector", validation_alias="VECTOR_BACKEND")

    # ── Embeddings ─────────────────────────────────────────────────────────────
    openai_api_key: str = Field(default="", validation_alias="OPENAI_API_KEY")
    embedding_model: str = Field(
        default="text-embedding-3-small", validation_alias="EMBEDDING_MODEL"
    )

    # ── Knowledge graph ────────────────────────────────────────────────────────
    neo4j_url: str = Field(default="bolt://localhost:7687", validation_alias="NEO4J_URL")
    neo4j_user: str = Field(default="neo4j", validation_alias="NEO4J_USER")
    neo4j_password: str = Field(default="", validation_alias="NEO4J_PASSWORD")

    # ── Live web learning ──────────────────────────────────────────────────────
    tavily_api_key: str = Field(default="", validation_alias="TAVILY_API_KEY")
    firecrawl_api_key: str = Field(default="", validation_alias="FIRECRAWL_API_KEY")

    # ── Observability / scheduling ─────────────────────────────────────────────
    langsmith_api_key: str = Field(default="", validation_alias="LANGSMITH_API_KEY")
    langsmith_project: str = Field(default="workdaemon-brain", validation_alias="LANGSMITH_PROJECT")
    inngest_event_key: str = Field(default="", validation_alias="INNGEST_EVENT_KEY")
    inngest_signing_key: str = Field(default="", validation_alias="INNGEST_SIGNING_KEY")

    # ── Optional gateways ──────────────────────────────────────────────────────
    telegram_bot_token: str = Field(default="", validation_alias="TELEGRAM_BOT_TOKEN")
    twilio_account_sid: str = Field(default="", validation_alias="TWILIO_ACCOUNT_SID")

    # ── Security ───────────────────────────────────────────────────────────────
    jwt_secret: str = Field(default="", validation_alias="JWT_SECRET")
    encryption_key: str = Field(default="", validation_alias="ENCRYPTION_KEY")


settings = Settings()
