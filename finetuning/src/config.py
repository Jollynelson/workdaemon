from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_ROOT_ENV = Path(__file__).parent.parent.parent / ".env"
_env_file = str(_ROOT_ENV) if _ROOT_ENV.exists() else None


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_env_file,
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Supabase (WorkDaemon main app DB) ──────────────────────────────────────
    supabase_url: str = Field(validation_alias="NEXT_PUBLIC_SUPABASE_URL")
    supabase_service_key: str = Field(validation_alias="SUPABASE_SERVICE_ROLE_KEY")
    database_url: str = Field(validation_alias="DATABASE_URL")

    # ── Hugging Face ───────────────────────────────────────────────────────────
    hf_token: str = Field(validation_alias="HF_TOKEN")
    hf_org: str = Field(default="workdaemon", validation_alias="HF_ORG")

    # ── Model — Qwen3-32B (Apache-2.0, text-only, long-context) ────────────────
    # Chosen 2026-06-04 for "Mistral-24B-like capacity + large context window":
    # 32B params, native 32K context extensible to 128K via YaRN, Apache 2.0, and
    # crucially TEXT-ONLY — so the GGUF→Ollama export path stays clean (Mistral
    # Small 3.1/3.2 give 128K but are multimodal, and Unsloth's vision-model GGUF
    # export is unreliable). We use Unsloth's pre-quantized dynamic 4-bit variant
    # as the QLoRA base. Qwen3 uses ChatML formatting (<|im_start|>/<|im_end|>,
    # eos=<|im_end|>) — handled automatically because train.py drives formatting
    # off the tokenizer's own chat_template.
    #
    # ⚠️ 128K is enabled at SERVING time via YaRN rope-scaling, not in training.
    # To serve >32K, set rope_scaling {"type":"yarn","factor":4.0,
    # "original_max_position_embeddings":32768} in the Ollama Modelfile / model
    # config (see unsloth/Qwen3-32B-128K-GGUF). Training runs at 2048 (below).
    # Override per-deploy with BASE_MODEL.
    base_model: str = Field(
        default="unsloth/Qwen3-32B-unsloth-bnb-4bit",
        validation_alias="BASE_MODEL",
    )

    # ── Training ───────────────────────────────────────────────────────────────
    # 4096: Qwen3-32B trains on an L40S (48GB) — see modal_app.py — which has ample
    # room for this seq after the ~19GB of 4-bit weights. Our training examples are
    # short Q&A anyway. Keep in sync with HYPERPARAMS["max_seq_length"]. (Serving
    # context is a separate axis — YaRN extends to 128K at serve time.)
    max_seq_length: int = 4096
    lora_r: int = 16
    lora_alpha: int = 16
    learning_rate: float = 2e-4
    num_epochs: int = 2                  # 2 not 3: 48h cadence avoids forgetting
    min_examples_to_train: int = Field(default=50, validation_alias="MIN_EXAMPLES_TO_TRAIN")
    training_window_hours: int = Field(default=48, validation_alias="TRAINING_WINDOW_HOURS")

    # ── Quality gate ───────────────────────────────────────────────────────────
    gate_epsilon: float = 0.01           # new model must score >= old - epsilon
    # Absolute floor: a model must score at least this on the held-out eval to be
    # deployed AT ALL — even a first model (which has no incumbent to beat) and even
    # one that beats a weak incumbent. Below it, the company stays on the shared brain
    # and retries next cycle. This is what stops live routing to a too-weak model.
    gate_min_score: float = Field(default=0.3, validation_alias="GATE_MIN_SCORE")
    # Baseline: the company model must beat the SHARED brain (the base model the
    # company would otherwise use) by this margin on the same eval to be routable.
    # This is the real "is the fine-tune actually better than what they have" bar.
    gate_baseline_margin: float = Field(default=0.05, validation_alias="GATE_BASELINE_MARGIN")
    baseline_model: str = Field(default="deepseek-chat", validation_alias="BASELINE_MODEL")
    # LLM judge for the gate (scores generated answers vs reference). Provider-
    # configurable so it isn't tied to one vendor's key. Default DeepSeek: it's
    # cheap, strong, independent of the candidate models, and DEEPSEEK_API_KEY is
    # already set in this stack. Supported: deepseek | openai | anthropic. Leave
    # judge_model empty to use the provider's default below.
    judge_provider: str = Field(default="deepseek", validation_alias="JUDGE_PROVIDER")
    judge_model: str = Field(default="", validation_alias="JUDGE_MODEL")
    deepseek_api_key: str = Field(default="", validation_alias="DEEPSEEK_API_KEY")
    deepseek_base_url: str = Field(
        default="https://api.deepseek.com", validation_alias="DEEPSEEK_BASE_URL"
    )

    # ── Modal ──────────────────────────────────────────────────────────────────
    modal_environment: str = "main"

    # ── Serving ────────────────────────────────────────────────────────────────
    serve_backend: str = Field(default="ollama", validation_alias="SERVE_BACKEND")
    warm_pool_business_hours: bool = Field(default=True, validation_alias="WARM_POOL_BUSINESS_HOURS")
    ollama_base_url: str = Field(default="http://localhost:11434", validation_alias="OLLAMA_BASE_URL")

    # ── Cold-start fallback ────────────────────────────────────────────────────
    anthropic_api_key: str = Field(default="", validation_alias="ANTHROPIC_API_KEY")
    fallback_model: str = "claude-haiku-4-5-20251001"   # fast + cheap for cold-start

    # ── Embeddings ─────────────────────────────────────────────────────────────
    embedding_model: str = Field(
        default="text-embedding-3-small",
        validation_alias="EMBEDDING_MODEL",
    )
    openai_api_key: str = Field(default="", validation_alias="OPENAI_API_KEY")
    embedding_dim: int = 1536            # text-embedding-3-small native dimension

    # ── Vector store ───────────────────────────────────────────────────────────
    vector_backend: str = Field(default="pgvector", validation_alias="VECTOR_BACKEND")
    postgres_url: str = Field(default="", validation_alias="POSTGRES_URL")

    # ── Cache / queues ─────────────────────────────────────────────────────────
    redis_url: str = Field(default="redis://localhost:6379", validation_alias="REDIS_URL")

    # ── Scheduling (Inngest) ───────────────────────────────────────────────────
    inngest_event_key: str = Field(default="", validation_alias="INNGEST_EVENT_KEY")
    inngest_signing_key: str = Field(default="", validation_alias="INNGEST_SIGNING_KEY")

    # ── Tool integrations (per company; encrypted at rest in production) ───────
    slack_bot_token: str = Field(default="", validation_alias="SLACK_BOT_TOKEN")
    notion_token: str = Field(default="", validation_alias="NOTION_TOKEN")
    google_service_account_key: str = Field(default="", validation_alias="GOOGLE_SERVICE_ACCOUNT_KEY")

    # ── Security ───────────────────────────────────────────────────────────────
    jwt_secret: str = Field(default="", validation_alias="JWT_SECRET")
    encryption_key: str = Field(default="", validation_alias="ENCRYPTION_KEY")
    # Master secret for the serving API (see src/api/auth.py). Per-company bearer
    # tokens are HMAC(master, company_id); the master also gates admin routes.
    # Empty = serve auth DISABLED (dev only).
    serve_master_secret: str = Field(default="", validation_alias="SERVE_MASTER_SECRET")


settings = Settings()
