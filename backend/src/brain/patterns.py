"""Cross-staff pattern detection (FINAL spec Section 11).

Runs hourly. Clusters recent interaction messages; when ≥3 distinct staff ask
semantically similar things, the Brain (Flash) analyses the cluster and writes a
detected_patterns row, then pushes an anonymized summary to managers. Names are
never surfaced — patterns are "multiple staff", per privacy (Section 13).

Clustering is injected (embeddings/semantic in prod; a keyword stub in tests) so
this is testable without a vector backend.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from src.brain.activity_feed import ActivityEvent, ActivityFeed
from src.brain.router import BrainRouter
from src.db import CompanyDB

PATTERN_PROMPT = """Multiple staff asked semantically similar things. Classify the
underlying issue. Return ONLY JSON:
{{"pattern_type": "repeated_question|shared_blocker|workflow_gap|knowledge_gap|cross_team_dependency|risk_signal",
  "title": "...", "detail": "...", "confidence": 0.0-1.0}}

Sample messages: {samples}
Distinct staff: {count}
"""

MIN_STAFF = 3


@dataclass
class Cluster:
    interaction_ids: list[str]
    staff_ids: list[str]
    sample_messages: list[str] = field(default_factory=list)


class PatternDetector:
    def __init__(
        self,
        db: CompanyDB,
        brain: BrainRouter,
        feed: ActivityFeed,
        cluster_fn: Callable[[list[dict]], list[Cluster]],
        push: Any | None = None,           # PushDeliverer for manager alerts
        managers_fn: Callable[[], list[str]] | None = None,
    ) -> None:
        self._db = db
        self._brain = brain
        self._feed = feed
        self._cluster = cluster_fn
        self._push = push
        self._managers = managers_fn or (lambda: [])

    def detect(self, days: int = 30) -> list[dict]:
        resp = self._db.select("interactions").order("created_at", desc=True).limit(500).execute()
        interactions = getattr(resp, "data", None) or []
        created: list[dict] = []

        for cluster in self._cluster(interactions):
            if len({*cluster.staff_ids}) < MIN_STAFF:
                continue
            analysis = self._brain.call(
                kind="brain", depth="fast", task_type="analysis",
                prompt=PATTERN_PROMPT.format(
                    samples=cluster.sample_messages, count=len({*cluster.staff_ids})
                ),
            ).json() or {}

            pattern = self._db.insert(
                "detected_patterns",
                {
                    "pattern_type": analysis.get("pattern_type", "repeated_question"),
                    "title": analysis.get("title", "Recurring staff question"),
                    "detail": analysis.get("detail", ""),
                    "evidence": cluster.interaction_ids,
                    "staff_involved": list({*cluster.staff_ids}),  # stored, never surfaced
                    "confidence": analysis.get("confidence", 0.5),
                },
            )
            created.append(pattern)
            self._feed.emit(
                ActivityEvent(
                    event_type="pattern_detected",
                    visible_to="managers",
                    payload={"pattern_id": pattern.get("id"), "title": pattern.get("title"),
                             "staff_count": len({*cluster.staff_ids})},
                )
            )
            if self._push:
                n = len({*cluster.staff_ids})
                for mgr in self._managers():
                    self._push.deliver(mgr, {
                        "kind": "pattern",
                        "pattern_id": pattern.get("id"),
                        "message": f"{n} staff are hitting the same issue: {pattern.get('title')}",
                        "recommended_action": pattern.get("detail", ""),
                    })
        return created
