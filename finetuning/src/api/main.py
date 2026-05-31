"""
Company Brain FastAPI application.

Routes:
  /api/staff      — staff + agent profile management
  /api/agents     — agent conversation + profile endpoints
  /api/brain      — hunt engine, context, push inbox
  /api/serve      — generic chat completion for the WorkDaemon Node app
  /ws/{company_id}/{staff_id} — real-time push via WebSocket
"""

from __future__ import annotations

import logging

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.api.auth import require_admin
from src.api.routes import agents, brain, serve, staff
from src.api.websocket import router as ws_router

logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="Company Brain API",
    description="The living intelligence layer for per-company AI agents.",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Internal ops routes — gated by the master (admin) secret.
_admin = [Depends(require_admin)]
app.include_router(staff.router,  prefix="/api/staff",  tags=["staff"],  dependencies=_admin)
app.include_router(agents.router, prefix="/api/agents", tags=["agents"], dependencies=_admin)
app.include_router(brain.router,  prefix="/api/brain",  tags=["brain"],  dependencies=_admin)
# Serve route does its own per-company token check (company_id is in the body).
app.include_router(serve.router,  prefix="/api/serve",  tags=["serve"])
app.include_router(ws_router,                           tags=["websocket"])


@app.get("/health")
def health():
    return {"status": "ok", "service": "company-brain"}
