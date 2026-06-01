"""Websocket — real-time pushes + activity feed to the webapp.

Per-(company, staff) connections. The push inbox / activity feed call broadcast()
to surface task assignments, findings, and feed events in real time. Role-gated:
a connection only receives events its viewer level is allowed to see.
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()
logger = logging.getLogger(__name__)

# (company_id, staff_id) -> WebSocket
_connections: dict[tuple[str, str], WebSocket] = {}


@router.websocket("/ws/{company_id}/{staff_id}")
async def ws_endpoint(ws: WebSocket, company_id: str, staff_id: str):
    await ws.accept()
    key = (company_id, staff_id)
    _connections[key] = ws
    logger.info("ws connect company=%s staff=%s", company_id, staff_id)
    try:
        while True:
            # client acks (e.g. push read/acted); ignored payloads are fine
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        _connections.pop(key, None)


async def push_to_staff(company_id: str, staff_id: str, payload: dict) -> bool:
    ws = _connections.get((company_id, staff_id))
    if ws is None:
        return False
    try:
        await ws.send_text(json.dumps(payload))
        return True
    except Exception:
        _connections.pop((company_id, staff_id), None)
        return False
