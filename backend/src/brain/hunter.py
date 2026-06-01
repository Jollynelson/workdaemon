"""The hunt engine (FINAL spec Section 12) — where DeepSeek earns its keep.

Five modes, two tiers, one schedule:
  threat/knowledge → fast (Flash), waste → fast, opportunity/performance → deep (Pro).
Intraday fast hunts triage signals (Flash, escalates to Pro on low confidence);
the nightly deep pass runs all modes over the whole-company context in one Pro
call (1M ctx). Findings become hunt_findings; high-confidence ones become pushes.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from src.brain.activity_feed import ActivityEvent, ActivityFeed
from src.brain.router import BrainRouter
from src.config import settings
from src.db import CompanyDB

HUNT_MODES = ("threat", "waste", "opportunity", "performance", "knowledge")

HUNT_SCHEDULE = {
    "threat": {"depth": "fast", "interval_hours": 1},
    "waste": {"depth": "fast", "interval_hours": 6},
    "opportunity": {"depth": "deep", "interval_hours": 24},
    "performance": {"depth": "deep", "interval_hours": 24},
    "knowledge": {"depth": "fast", "interval_hours": 6},
}

HUNT_PROMPT = """You are the company Brain running a {mode} hunt. From the company
context, surface concrete {mode} findings. Return ONLY JSON:
{{"findings": [{{"title": "...", "detail": "...", "confidence": 0.0-1.0,
  "target_role": "<role or null>"}}], "confidence": 0.0-1.0}}

Company context:
{context}
"""

NIGHTLY_PROMPT = """You are the company Brain running the nightly deep analysis.
Run all five hunts (threat, waste, opportunity, performance, knowledge) over the
whole company in one pass. Return ONLY JSON:
{{"findings": [{{"mode": "<one of the five>", "title": "...", "detail": "...",
  "confidence": 0.0-1.0, "target_role": "<role or null>"}}]}}

Whole-company context:
{context}
Open patterns: {patterns}
Recent activity summary: {feed_summary}
"""

PUSH_THRESHOLD = 0.7


@dataclass
class HuntResult:
    mode: str
    depth: str
    findings: list[dict]


class HuntEngine:
    def __init__(
        self,
        db: CompanyDB,
        brain: BrainRouter,
        feed: ActivityFeed,
        assemble_context: Callable[[str], str],   # (mode|'nightly') -> context string
        push: Any | None = None,
        resolve_target: Callable[[str], str | None] | None = None,  # role -> staff_id
    ) -> None:
        self._db = db
        self._brain = brain
        self._feed = feed
        self._assemble = assemble_context
        self._push = push
        self._resolve_target = resolve_target or (lambda role: None)

    def run_hunt(self, mode: str) -> HuntResult:
        if mode not in HUNT_MODES:
            raise ValueError(f"unknown hunt mode: {mode}")
        depth = HUNT_SCHEDULE[mode]["depth"]
        resp = self._brain.call(
            kind="brain", depth=depth, task_type="analysis",
            prompt=HUNT_PROMPT.format(mode=mode, context=self._assemble(mode)),
        )
        data = resp.json() or {}
        findings = self._persist(data.get("findings", []), default_mode=mode,
                                 depth=depth, brain_model=resp.model)
        return HuntResult(mode=mode, depth=depth, findings=findings)

    def nightly_deep_pass(self) -> list[dict]:
        resp = self._brain.call(
            kind="brain", depth="deep", task_type="analysis",
            prompt=NIGHTLY_PROMPT.format(
                context=self._assemble("nightly"),
                patterns=self._open_patterns(),
                feed_summary=self._assemble("feed_summary"),
            ),
        )
        data = resp.json() or {}
        return self._persist(data.get("findings", []), default_mode="threat",
                             depth="deep", brain_model=resp.model)

    def _persist(self, findings: list[dict], default_mode: str, depth: str,
                 brain_model: str) -> list[dict]:
        out = []
        for f in findings:
            mode = f.get("mode", default_mode)
            if mode not in HUNT_MODES:
                mode = default_mode
            row = self._db.insert(
                "hunt_findings",
                {
                    "mode": mode,
                    "title": f.get("title", "Untitled finding"),
                    "detail": f.get("detail", ""),
                    "confidence": f.get("confidence", 0.5),
                    "depth": depth,
                    "brain_model": brain_model,
                    "target_role": f.get("target_role"),
                    "status": "open",
                },
            )
            out.append(row)
            self._feed.emit(
                ActivityEvent(event_type="hunt_finding", visible_to="managers",
                              payload={"finding_id": row.get("id"), "mode": mode,
                                       "title": row.get("title")})
            )
            if self._push and f.get("confidence", 0) >= PUSH_THRESHOLD and f.get("target_role"):
                staff_id = self._resolve_target(f["target_role"])
                if staff_id:
                    self._push.deliver(staff_id, {
                        "kind": "hunt_finding",
                        "finding_id": row.get("id"),
                        "message": f.get("title", ""),
                        "recommended_action": f.get("detail", ""),
                    })
        return out

    def _open_patterns(self) -> str:
        resp = self._db.select("detected_patterns").eq("status", "open").limit(20).execute()
        rows = getattr(resp, "data", None) or []
        return "; ".join(r.get("title", "") for r in rows)
