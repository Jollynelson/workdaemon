"""Deploy the WorkDaemon FINAL-spec backend as a Modal ASGI web endpoint.

    modal deploy backend/deploy/modal_app.py

CPU only (the Brain is DeepSeek's hosted API; embeddings are the small local
fastembed model). Secrets come from the `workdaemon-backend-secret` Modal secret
(DeepSeek + Supabase + Redis). The whole src/ package is mounted.
"""

from __future__ import annotations

import modal

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "fastapi>=0.111.0",
        "uvicorn>=0.29.0",
        "pydantic>=2.7.0",
        "pydantic-settings>=2.2.0",
        "python-dotenv>=1.0.0",
        "httpx>=0.27.0",
        "openai>=1.30.0",
        "fastembed>=0.3.0",
        "supabase>=2.4.0",
        "redis>=5.0.0",
        "cryptography>=42.0.0",
    )
    # mount the backend src/ so `import src...` works inside the container
    .add_local_python_source("src")
)

app = modal.App("workdaemon-backend")

# bump to bust Modal's local-source mount cache on redeploy
_SRC_REV = "2026-06-01.4"


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("workdaemon-backend-secret")],
    timeout=60 * 5,
    min_containers=0,        # scale to zero; brain calls are hosted so cold start is cheap
    scaledown_window=600,
)
@modal.asgi_app()
def fastapi_app():
    from src.api.main import app as fastapi

    return fastapi
