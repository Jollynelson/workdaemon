"""
Platform embeddings on Modal — powers WorkDaemon knowledge-base search so
customers only ever connect a *reasoning* key. Self-contained + scale-to-zero:
Ollama with `nomic-embed-text` (768-dim) inside the container.

Deploy:
    modal deploy finetuning/modal/embeddings_app.py
Then take the printed web URL and set on the Node app (Vercel env):
    EMBEDDINGS_PROVIDER=modal
    MODAL_EMBEDDINGS_URL=<the https://…modal.run URL printed on deploy>
    MODAL_SERVE_SECRET=<same value as the SERVE_MASTER_SECRET Modal secret>
Finally re-embed existing docs:  POST /api/brain {action:"reindex"} (admin).

Contract (matches api/_lib/ingestion.js embed()):
    POST  { "input": ["text", ...], "model": "nomic-embed-text" }
    Auth  Authorization: Bearer <SERVE_MASTER_SECRET>
    →     { "embeddings": [[...768 floats...], ...], "model": "...", "dim": 768 }

NOTE: Modal's API drifts between versions — if `fastapi_endpoint`/`scaledown_window`
are renamed in your installed modal, adjust (older: web_endpoint / container_idle_timeout).
"""

from __future__ import annotations

import os
import subprocess
import time

import modal
from fastapi import Request  # annotate so FastAPI injects the Request (not a query param)

EMBED_MODEL = os.environ.get("EMBEDDINGS_MODEL", "nomic-embed-text")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("curl", "zstd")  # ollama's installer now extracts with zstd
    .run_commands("curl -fsSL https://ollama.com/install.sh | sh")
    .pip_install("fastapi[standard]>=0.111.0", "httpx>=0.27.0")
)

app = modal.App("workdaemon-embeddings")
# Persist the pulled model across cold starts.
model_volume = modal.Volume.from_name("workdaemon-embed-models", create_if_missing=True)

OLLAMA = "http://127.0.0.1:11434"


def _ensure_ollama_and_model() -> None:
    import httpx
    def up() -> bool:
        try:
            httpx.get(f"{OLLAMA}/api/tags", timeout=2.0); return True
        except Exception:
            return False
    if not up():
        subprocess.Popen(["ollama", "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(60):
            if up():
                break
            time.sleep(1)
    # Pull the embedding model once (cached in the Volume thereafter).
    tags = httpx.get(f"{OLLAMA}/api/tags", timeout=5.0).json()
    have = {m.get("name", "").split(":")[0] for m in tags.get("models", [])}
    if EMBED_MODEL.split(":")[0] not in have:
        subprocess.run(["ollama", "pull", EMBED_MODEL], check=True)


@app.function(
    image=image,
    volumes={"/root/.ollama": model_volume},
    timeout=600,
    scaledown_window=300,          # stay warm 5 min after the last call, then scale to zero
    secrets=[modal.Secret.from_name("workdaemon-serve-secret")],  # provides SERVE_MASTER_SECRET
)
@modal.concurrent(max_inputs=8)
@modal.fastapi_endpoint(method="POST")
def embeddings(item: dict, request: Request):
    import httpx
    from fastapi import HTTPException

    # Auth: bearer must equal the master secret (Node sends MODAL_SERVE_SECRET).
    master = os.environ.get("SERVE_MASTER_SECRET")
    if master:
        auth = request.headers.get("authorization", "")
        token = auth.split(" ", 1)[1].strip() if auth.startswith("Bearer ") else ""
        if token != master:
            raise HTTPException(status_code=401, detail="unauthorized")

    inputs = item.get("input") or []
    model = item.get("model") or EMBED_MODEL
    if not isinstance(inputs, list) or not inputs:
        raise HTTPException(status_code=400, detail="input must be a non-empty array")

    _ensure_ollama_and_model()
    vectors: list[list[float]] = []
    with httpx.Client(timeout=120.0) as c:
        for text in inputs:
            r = c.post(f"{OLLAMA}/api/embeddings", json={"model": model, "prompt": str(text)[:8000]})
            r.raise_for_status()
            vectors.append(r.json().get("embedding", []))
    return {"embeddings": vectors, "model": model, "dim": len(vectors[0]) if vectors else 0}
