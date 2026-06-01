"""Close the learning loop (FINAL spec §4 / original spec §6).

Each company's real interactions are logged to `training_signals` by the backend
on every turn. This job finds companies with enough UNUSED signals and triggers
the per-company fine-tune (the finetuning/ pipeline's run_company → Unsloth QLoRA
on Modal → quality gate → deploy wd-{company_id}). After training, that company's
agent chat automatically routes to its own model (the hybrid router checks
model_versions).

Training itself runs in the finetuning Modal app; this is the SELECTOR + trigger.
Per-company isolation holds: one run_company call = one company.
"""

from __future__ import annotations

import logging

from src.config import settings
from src.db import CompanyDB, supabase_client

logger = logging.getLogger(__name__)


def companies_ready_to_train(min_examples: int | None = None) -> list[str]:
    """company_ids with >= min unused training_signals (window-agnostic count)."""
    threshold = min_examples or settings_min_examples()
    sb = supabase_client()
    resp = (
        sb.table("training_signals")
        .select("company_id")
        .is_("used_in_version", "null")
        .execute()
    )
    rows = getattr(resp, "data", None) or []
    counts: dict[str, int] = {}
    for r in rows:
        cid = r.get("company_id")
        if cid:
            counts[cid] = counts.get(cid, 0) + 1
    return [cid for cid, n in counts.items() if n >= threshold]


def settings_min_examples() -> int:
    # The finetuning pipeline owns MIN_EXAMPLES_TO_TRAIN; mirror its default here
    # so the selector and the trainer agree.
    import os

    return int(os.environ.get("MIN_EXAMPLES_TO_TRAIN", "50"))


def trigger_training(company_id: str) -> dict:
    """Invoke the finetuning pipeline's run_company on Modal for one company.

    The finetuning app (`workdaemon-finetuning`) exposes run_training; run_company
    orchestrates dataset build → train → gate → deploy. We call it by Modal lookup
    so the backend image doesn't need the training deps.
    """
    try:
        import modal

        run_company = modal.Function.from_name("workdaemon-finetuning", "run_company_remote")
        run_company.spawn(company_id)  # fire-and-forget; training is long-running
        return {"company_id": company_id, "training": "enqueued"}
    except Exception as exc:
        logger.warning("company=%s training trigger failed: %s", company_id, exc)
        return {"company_id": company_id, "training": "failed", "error": str(exc)[:200]}


def run_training_cycle() -> list[dict]:
    """The 48h tick: train every company that has accumulated enough signals."""
    ready = companies_ready_to_train()
    logger.info("training cycle: %d companies ready", len(ready))
    return [trigger_training(cid) for cid in ready]
