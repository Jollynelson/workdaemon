"""Prewarm route — kick the company's GPU model the instant the user logs in.

The frontend calls this (fire-and-forget) on sign-in / session restore, so the
scale-to-zero serving GPU is cold-starting while the user reads their catch-up
briefing. Identity is derived server-side (resolve_identity), so a caller can only
warm their own company's model. Returns immediately — never blocks on the GPU."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from src.agents import company_model
from src.agents.company_model import has_deployed_adapter
from src.api.auth import Identity, resolve_identity
from src.api.deps import company_db
from src.config import settings

router = APIRouter()


class WarmResponse(BaseModel):
    warming: bool


@router.post("/warm")
def warm(ident: Identity = Depends(resolve_identity)) -> WarmResponse:
    if not settings.serving_url:
        return WarmResponse(warming=False)
    if not has_deployed_adapter(ident.company_id, company_db(ident.company_id)):
        return WarmResponse(warming=False)
    company_model.warm(ident.company_id)  # fire-and-forget, swallows errors
    return WarmResponse(warming=True)
