FROM python:3.11-slim

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps (base only — GPU deps run on Modal, not here)
COPY pyproject.toml .
RUN pip install --no-cache-dir \
    fastapi \
    uvicorn \
    inngest \
    supabase \
    pydantic-settings \
    python-dotenv \
    anthropic \
    httpx \
    modal

# Copy source
COPY src/ ./src/

# Railway injects PORT automatically
CMD ["sh", "-c", "uvicorn src.orchestration.inngest_functions:fastapi_app --host 0.0.0.0 --port ${PORT:-8000}"]
