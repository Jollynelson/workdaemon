"""Cross-agent event bus — targeted daemon-to-daemon signals.

The activity feed is a broadcast (whole-company) channel. This bus carries events
addressed to a *specific* daemon (cross-daemon doc: ASSIGNMENT_FLAGGED,
AVAILABILITY_UPDATE, etc.) — written to Postgres (auditable, company-scoped) and
pushed on a per-staff Redis channel for real-time delivery.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from src.brain.activity_feed import Publisher
from src.db import CompanyDB

DAEMON_EVENT_TYPES = frozenset(
    {"ASSIGNMENT_FLAGGED", "AVAILABILITY_UPDATE", "TASK_ASSIGNED", "BROADCAST", "ESCALATION"}
)


@dataclass
class DaemonEvent:
    type: str
    from_staff_id: str | None
    to_staff_id: str | None          # None = company-wide broadcast
    content: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.type not in DAEMON_EVENT_TYPES:
            raise ValueError(f"unknown daemon event type: {self.type}")


def staff_channel(company_id: str, staff_id: str) -> str:
    return f"daemon:{company_id}:{staff_id}"


def broadcast_channel(company_id: str) -> str:
    return f"daemon_broadcast:{company_id}"


class CrossAgentBus:
    def __init__(self, db: CompanyDB, publisher: Publisher | None = None) -> None:
        self._db = db
        self._publisher = publisher

    def send(self, event: DaemonEvent) -> dict:
        import json

        row = self._db.insert(
            "activity_events",
            {
                "staff_id": event.from_staff_id,
                "event_type": "assignment_flagged"
                if event.type == "ASSIGNMENT_FLAGGED"
                else "availability_update"
                if event.type == "AVAILABILITY_UPDATE"
                else "cross_agent_handoff",
                "payload": {
                    "daemon_event": event.type,
                    "to_staff_id": event.to_staff_id,
                    "content": event.content,
                },
                "visible_to": "brain",
            },
        )
        if self._publisher:
            channel = (
                broadcast_channel(self._db.company_id)
                if event.to_staff_id is None
                else staff_channel(self._db.company_id, event.to_staff_id)
            )
            self._publisher.publish(channel, json.dumps({"type": event.type, **event.content}))
        return row
