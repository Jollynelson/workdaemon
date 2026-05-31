import os


def pytest_configure(config):
    """Set required env vars before any module is imported during collection."""
    # Auth/data
    os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321")
    os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-key")
    os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/test")
    # HF
    os.environ.setdefault("HF_TOKEN", "test-hf-token")
    os.environ.setdefault("HF_ORG", "workdaemon-test")
    # AI
    os.environ.setdefault("ANTHROPIC_API_KEY", "test-anthropic-key")
    os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
    # Vector store
    os.environ.setdefault("POSTGRES_URL", "postgresql://brain:brainpass@localhost:5432/company_brain")
    os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
