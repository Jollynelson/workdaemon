"""Activity feed — FINAL spec Section 8. The Brain's live view of the company.

Every meaningful event is (1) persisted to activity_events for the nightly deep
pass, (2) published to a per-company Redis channel for real-time Brain
consumption, and (3) forwarded to the webapp websocket, role-gated by visible_to.

Publisher + broadcaster are injected behind Protocols so this is testable without
Redis or a live socket.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from src.db import CompanyDB

EVENT_TYPES = frozenset(
    {
        "agent_interaction",
        "task_created",
        "task_completed",
        "task_handed_off",
        "tool_called",
        "pattern_detected",
        "push_sent",
        "hunt_finding",
        "cross_agent_handoff",
        "ingestion_complete",
        "availability_update",     # cross-daemon capacity signal
        "assignment_flagged",      # cross-daemon pushback
    }
)

VISIBILITY = frozenset({"brain", "executives", "managers", "all"})


@dataclass
class ActivityEvent:
    event_type: str
    payload: dict
    staff_id: str | None = None
    visible_to: str = "brain"
    meta: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.event_type not in EVENT_TYPES:
            raise ValueError(f"unknown event_type: {self.event_type}")
        if self.visible_to not in VISIBILITY:
            raise ValueError(f"unknown visibility: {self.visible_to}")


class Publisher(Protocol):
    def publish(self, channel: str, message: str) -> None: ...


class Broadcaster(Protocol):
    def broadcast(self, company_id: str, event: dict, visibility: str) -> None: ...


def channel_for(company_id: str) -> str:
    return f"company_feed:{company_id}"


class ActivityFeed:
    def __init__(
        self,
        db: CompanyDB,
        publisher: Publisher | None = None,
        broadcaster: Broadcaster | None = None,
    ) -> None:
        self._db = db
        self._publisher = publisher
        self._broadcaster = broadcaster

    def emit(self, event: ActivityEvent) -> dict:
        import json

        row = self._db.insert(
            "activity_events",
            {
                "staff_id": event.staff_id,
                "event_type": event.event_type,
                "payload": event.payload,
                "visible_to": event.visible_to,
            },
        )
        envelope = {
            "id": row.get("id"),
            "company_id": self._db.company_id,
            "event_type": event.event_type,
            "staff_id": event.staff_id,
            "payload": event.payload,
            "visible_to": event.visible_to,
        }
        if self._publisher:
            self._publisher.publish(channel_for(self._db.company_id), json.dumps(envelope))
        if self._broadcaster:
            self._broadcaster.broadcast(self._db.company_id, envelope, event.visible_to)
        return envelope


def redis_publisher() -> Publisher:
    """Production publisher backed by Redis."""
    import redis

    from src.config import settings

    client = redis.from_url(settings.redis_url)

    class _RedisPub:
        def publish(self, channel: str, message: str) -> None:
            client.publish(channel, message)

    return _RedisPub()
