"""WorkDaemon backend FastAPI app (FINAL spec Section 4/15).

The single backend the webapp + optional gateways call. Mounts chat (the Brain's
visibility entry point), tasks, feed/pushes, and the websocket.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.api.routes import chat, feed, integrations, tasks
from src.api.websocket import router as ws_router

app = FastAPI(title="WorkDaemon Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router, prefix="/api", tags=["chat"])
app.include_router(tasks.router, prefix="/api", tags=["tasks"])
app.include_router(feed.router, prefix="/api", tags=["feed"])
app.include_router(integrations.router, prefix="/api", tags=["integrations"])
app.include_router(ws_router, tags=["websocket"])


@app.get("/health")
def health():
    return {"status": "ok", "service": "workdaemon-backend"}
