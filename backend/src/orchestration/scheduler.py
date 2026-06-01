"""Scheduler entrypoints (FINAL spec §16).

Scheduler-agnostic by design. The canonical schedule lives here as data; any
trigger (Inngest, Celery beat, cron + `python -m`, a cloud scheduler) calls the
tick functions. We do NOT hard-depend on Inngest — if it's configured we expose
functions for it, otherwise these run from a plain cron.

Cadence (FINAL spec): nightly deep pass 1×/day; patterns hourly; fast hunts on
the HUNT_SCHEDULE intervals.
"""

from __future__ import annotations

from src.orchestration import jobs

SCHEDULE = {
    "nightly_deep_pass": {"cron": "0 2 * * *"},     # 02:00 daily
    "hourly_patterns": {"cron": "0 * * * *"},        # top of every hour
    "intraday_hunts": {"cron": "0 */1 * * *"},       # hourly; job self-filters fast modes
    # NOTE: the ACTIVE 48h training trigger is the Modal cron `training_cycle` in
    # finetuning/modal_app.py (it has Modal + the training code). This entry mirrors
    # it for completeness / manual invocation; don't wire a second live cron here.
    "training_cycle": {"cron": "0 3 */2 * *"},       # every 2 days at 03:00 — per-company retrain
}


def tick_nightly() -> list[dict]:
    return jobs.fan_out(jobs.nightly_deep_pass)


def tick_patterns() -> list[dict]:
    return jobs.fan_out(jobs.hourly_patterns)


def tick_hunts() -> list[dict]:
    return jobs.fan_out(jobs.intraday_hunts)


def tick_training() -> list[dict]:
    # Train every company that has accumulated enough new interaction signals.
    from src.orchestration.training_loop import run_training_cycle

    return run_training_cycle()


TICKS = {
    "nightly_deep_pass": tick_nightly,
    "hourly_patterns": tick_patterns,
    "intraday_hunts": tick_hunts,
    "training_cycle": tick_training,
}


def run_tick(name: str) -> list[dict]:
    """Run one scheduled tick by name (the single entry a cron line calls)."""
    if name not in TICKS:
        raise ValueError(f"unknown tick: {name}; known: {sorted(TICKS)}")
    return TICKS[name]()


# ── Optional Inngest registration ───────────────────────────────────────────────
def register_inngest():  # pragma: no cover - only when inngest configured
    """Return Inngest functions if the SDK + keys are present, else None."""
    from src.config import settings

    if not settings.inngest_signing_key:
        return None
    try:
        import inngest
    except Exception:
        return None

    client = inngest.Inngest(app_id="workdaemon-brain")
    fns = []
    for name, cfg in SCHEDULE.items():
        @client.create_function(  # noqa: B023
            fn_id=name, trigger=inngest.TriggerCron(cron=cfg["cron"])
        )
        def _fn(ctx, _name=name):  # noqa: B023
            return run_tick(_name)

        fns.append(_fn)
    return client, fns


if __name__ == "__main__":  # cron entry: python -m src.orchestration.scheduler <tick>
    import json
    import sys

    print(json.dumps(run_tick(sys.argv[1] if len(sys.argv) > 1 else "intraday_hunts"), indent=2))
