"""Integration routes — connect a data source/tool and trigger ingestion.

Identity (company) is derived from the token. Staff connect tools in the webapp;
the backend stores the token encrypted and ingests their data into RAG. The UI
shows "Connected ✓" — it never surfaces provider internals.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from src.api.auth import Identity, resolve_identity
from src.api.deps import company_db
from src.integrations.ingest_service import ingest_all_connected, ingest_company_source
from src.integrations.store import IntegrationStore

router = APIRouter()


class ConnectRequest(BaseModel):
    provider: str                 # notion | slack | gdrive | ...
    access_token: str             # OAuth/bot token from the connect flow
    metadata: dict = {}
    ingest_now: bool = True


@router.get("/integrations")
def list_integrations(ident: Identity = Depends(resolve_identity)):
    return {"connected": IntegrationStore(company_db(ident.company_id)).list_connected()}


@router.post("/integrations/connect")
def connect(body: ConnectRequest, ident: Identity = Depends(resolve_identity)):
    store = IntegrationStore(company_db(ident.company_id))
    store.connect(body.provider, body.access_token, body.metadata)
    result = {"provider": body.provider, "status": "connected"}
    if body.ingest_now:
        result["ingest"] = ingest_company_source(ident.company_id, body.provider)
    return result


@router.post("/integrations/ingest")
def trigger_ingest(ident: Identity = Depends(resolve_identity)):
    """Re-ingest all of this company's connected sources into RAG."""
    return {"results": ingest_all_connected(ident.company_id)}
