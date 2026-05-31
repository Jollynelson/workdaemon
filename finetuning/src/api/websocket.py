"""
WebSocket endpoint — real-time push delivery to agent UIs.

Staff connect on login; the Brain pushes intelligence without polling.
Connection is per-staff, scoped by company_id for isolation.
"""

from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from src.db import db
from src.push.inbox import get_pending_pushes, mark_delivered

router = APIRouter()
logger = logging.getLogger(__name__)

# In-memory registry: (company_id, staff_id) → WebSocket
_connections: dict[tuple[str, str], WebSocket] = {}


@router.websocket("/ws/{company_id}/{staff_id}")
async def websocket_endpoint(ws: WebSocket, company_id: str, staff_id: str):
    await ws.accept()
    key = (company_id, staff_id)
    _connections[key] = ws
    logger.info("WS connected: company=%s staff=%s", company_id, staff_id)

    try:
        # Immediately deliver any pending pushes
        await _flush_pending(ws, company_id, staff_id)

        # Keep alive — listen for client acknowledgements
        while True:
            data = await ws.receive_text()
            msg = json.loads(data)
            if msg.get("type") == "push_acted":
                from src.push.inbox import mark_acted_on
                mark_acted_on(msg["push_id"], msg.get("acted", False), db())
    except WebSocketDisconnect:
        logger.info("WS disconnected: company=%s staff=%s", company_id, staff_id)
    finally:
        _connections.pop(key, None)


async def _flush_pending(ws: WebSocket, company_id: str, staff_id: str) -> None:
    client = db()
    pushes = get_pending_pushes(company_id, staff_id, client)
    for push in pushes:
        await ws.send_json({"type": "push", "payload": push})
        mark_delivered(push["id"], client)


async def broadcast_push(company_id: str, staff_id: str, payload: dict) -> bool:
    """Send a push to a connected agent. Returns False if not connected."""
    ws = _connections.get((company_id, staff_id))
    if ws is None:
        return False
    try:
        await ws.send_json({"type": "push", "payload": payload})
        return True
    except Exception:
        _connections.pop((company_id, staff_id), None)
        return False
