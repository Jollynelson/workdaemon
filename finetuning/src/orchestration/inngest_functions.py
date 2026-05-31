"""
Inngest orchestration: 48h cron + per-company fan-out.

Architecture:
  - Cron fires every 48h → fetches all active company IDs → emits one
    'company/finetune.requested' event per company.
  - Per-company handler receives the event → calls run_company().
  - Concurrency cap (5) prevents spinning up more than 5 T4 GPUs at once.
  - Retries (2) with automatic Inngest backoff handle transient Modal failures.

Running locally:
    uvicorn src.orchestration.inngest_functions:fastapi_app --port 8000
    npx inngest-cli@latest dev -u http://localhost:8000/api/inngest
"""

from __future__ import annotations

import logging

import inngest
import inngest.fast_api
from fastapi import FastAPI

import src.db as db
from src.config import settings
from src.orchestration.run_company import run_company
from src.orchestration.run_hunt import run_hunt_for_company

logger = logging.getLogger(__name__)

FINETUNE_EVENT = "company/finetune.requested"
HUNT_EVENT = "company/hunt.requested"

# ── Inngest client ─────────────────────────────────────────────────────────────

client = inngest.Inngest(
    app_id="workdaemon-finetuning",
    event_key=settings.inngest_event_key or None,
    signing_key=settings.inngest_signing_key or None,
    is_production=bool(settings.inngest_signing_key),
)


# ── Cron trigger ───────────────────────────────────────────────────────────────


@client.create_function(
    fn_id="finetune-cron",
    trigger=inngest.TriggerCron(cron="0 0 */2 * *"),   # midnight every 2 days ≈ 48h
)
async def finetune_cron(ctx: inngest.Context, step: inngest.Step) -> dict:
    """
    Every 48h: fetch active company IDs and fan out one event per company.
    Failures for individual companies are isolated — one bad company never
    blocks the rest.
    """
    company_ids: list[str] = await step.run(
        "get-active-companies",
        db.get_active_companies,
    )

    logger.info("Cron: %d active companies found.", len(company_ids))

    if not company_ids:
        return {"companies_triggered": 0}

    events = [
        inngest.Event(name=FINETUNE_EVENT, data={"company_id": cid})
        for cid in company_ids
    ]
    await step.send_event("fan-out", events)

    logger.info("Cron: emitted %d '%s' events.", len(events), FINETUNE_EVENT)
    return {"companies_triggered": len(events)}


# ── Per-company handler ────────────────────────────────────────────────────────


@client.create_function(
    fn_id="finetune-company",
    trigger=inngest.TriggerEvent(event=FINETUNE_EVENT),
    concurrency=[
        inngest.Concurrency(limit=5),          # max 5 T4 GPUs at once globally
    ],
    retries=2,                                  # 2 retries with exponential backoff
)
async def finetune_company(ctx: inngest.Context, step: inngest.Step) -> dict:
    """
    Per-company handler: receives a 'company/finetune.requested' event and
    runs the full fine-tuning pipeline for that company.
    """
    company_id: str = ctx.event.data["company_id"]
    logger.info("Handler: starting run for company=%s", company_id)

    await step.run(
        "run-company",
        lambda: run_company(company_id),
    )

    logger.info("Handler: completed run for company=%s", company_id)
    return {"company_id": company_id, "status": "done"}


# ── Hunt cron (every hour) + per-company fan-out ────────────────────────────────
# Spec Section 16 step 16 + Reality Check 6: the Hunt engine is scheduled jobs,
# not sentience. Hourly is a sensible default; tighten per mode later if needed.


@client.create_function(
    fn_id="hunt-cron",
    trigger=inngest.TriggerCron(cron="0 * * * *"),   # top of every hour
)
async def hunt_cron(ctx: inngest.Context, step: inngest.Step) -> dict:
    """Every hour: fan out a hunt event per company (canonical `companies` table)."""
    company_ids: list[str] = await step.run(
        "get-active-companies",
        db.get_active_companies,
    )

    if not company_ids:
        return {"companies_triggered": 0}

    events = [
        inngest.Event(name=HUNT_EVENT, data={"company_id": cid})
        for cid in company_ids
    ]
    await step.send_event("hunt-fan-out", events)
    logger.info("Hunt cron: emitted %d '%s' events.", len(events), HUNT_EVENT)
    return {"companies_triggered": len(events)}


@client.create_function(
    fn_id="hunt-company",
    trigger=inngest.TriggerEvent(event=HUNT_EVENT),
    concurrency=[inngest.Concurrency(limit=10)],   # hunts are cheap (no GPU)
    retries=1,
)
async def hunt_company(ctx: inngest.Context, step: inngest.Step) -> dict:
    """Per-company handler: run all 5 hunt modes + auto-push findings."""
    company_id: str = ctx.event.data["company_id"]
    result = await step.run(
        "run-hunt",
        lambda: run_hunt_for_company(company_id),
    )
    logger.info(
        "Hunt for company=%s: %d findings, %d pushes.",
        company_id, result.get("findings_created", 0), result.get("pushes_sent", 0),
    )
    return {"company_id": company_id, **result}


# ── FastAPI server ─────────────────────────────────────────────────────────────

fastapi_app = FastAPI(title="WorkDaemon Orchestration — Fine-Tune + Hunt")

inngest.fast_api.serve(
    fastapi_app,
    client,
    [finetune_cron, finetune_company, hunt_cron, hunt_company],
)
