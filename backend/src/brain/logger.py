"""Interaction logging + the three learning loops (FINAL spec Section 10).

Every staff↔agent interaction writes to:
  1. Individual — the interactions row + (later) the user's memory namespace;
     trust_score nudged by suggestion_acted_on.
  2. Role — anonymized signal toward the role index (via training_signals).
  3. Company — emits a training_signals row for distillation and feeds pattern
     detection.

Pure DB orchestration (CompanyDB injected) so it's testable without Postgres.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from src.db import CompanyDB


@dataclass
class Interaction:
    staff_id: str
    role: str
    user_message: str
    agent_response: str
    tools_called: list = field(default_factory=list)
    context_chunks: list = field(default_factory=list)
    triggered_by_task_id: str | None = None
    suggestion_acted_on: bool | None = None
    sentiment: str | None = None


class InteractionLogger:
    def __init__(self, db: CompanyDB) -> None:
        self._db = db

    def log(self, interaction: Interaction) -> dict:
        row = self._db.insert(
            "interactions",
            {
                "staff_id": interaction.staff_id,
                "role": interaction.role,
                "user_message": interaction.user_message,
                "agent_response": interaction.agent_response,
                "tools_called": interaction.tools_called,
                "context_chunks": interaction.context_chunks,
                "triggered_by_task_id": interaction.triggered_by_task_id,
                "suggestion_acted_on": interaction.suggestion_acted_on,
                "sentiment": interaction.sentiment,
            },
        )

        # Loop 3 (company): training signal for later distillation / fine-tune.
        # Only capture turns worth learning from (acted-on or substantive).
        if interaction.suggestion_acted_on or len(interaction.agent_response) > 40:
            self._db.insert(
                "training_signals",
                {
                    "interaction_id": row.get("id"),
                    "kind": "positive_pair"
                    if interaction.suggestion_acted_on
                    else "interaction",
                    "prompt": interaction.user_message,
                    "target": interaction.agent_response,
                    "score": 1.0 if interaction.suggestion_acted_on else None,
                },
            )

        # Loop 1 (individual): nudge trust + interaction count on the profile.
        self._bump_profile(interaction.staff_id, interaction.suggestion_acted_on)
        return row

    def _bump_profile(self, staff_id: str, acted_on: bool | None) -> None:
        prow = self._db.select("agent_profiles").eq("staff_id", staff_id).limit(1).execute()
        rows = getattr(prow, "data", None) or []
        if not rows:
            return
        p = rows[0]
        patch = {"interaction_count": (p.get("interaction_count", 0) or 0) + 1}
        if acted_on is True:
            patch["trust_score"] = min(2.0, (p.get("trust_score", 1.0) or 1.0) + 0.02)
        elif acted_on is False:
            patch["trust_score"] = max(0.0, (p.get("trust_score", 1.0) or 1.0) - 0.05)
        self._db.update("agent_profiles", p["id"], patch)
