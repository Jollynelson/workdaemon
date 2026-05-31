"""
Seed fake interactions and training signals for testing the learning pipeline.

Creates enough interactions to trigger:
  - Pattern detection (3+ staff asking about same topic)
  - Fine-tune dataset building (≥50 positive pairs)
  - Hunt findings (after-hours pattern, knowledge gap)

Run: python scripts/seed_signals.py
"""

from __future__ import annotations

import os
import random
import sys
import uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import src.db as db_module

COMPANY_A = "aaaaaaaa-0001-0001-0001-000000000001"

SAMPLE_INTERACTIONS = [
    # Knowledge gap — approval process (3+ staff asking)
    {"role": "Junior Developer", "message": "How long does the vendor approval process take?",
     "response": "The vendor approval process typically takes 6-8 business days.", "sentiment": "frustrated"},
    {"role": "Sales Manager",    "message": "What is our vendor approval process timeline?",
     "response": "Vendor approvals go through 3 stages, usually 5-7 days.", "sentiment": "neutral"},
    {"role": "HR Director",      "message": "Why does vendor approval take so long?",
     "response": "Step 3 of vendor approval accounts for most of the delay.", "sentiment": "frustrated"},
    # Performance — after-hours (late night)
    {"role": "Junior Developer", "message": "Can you summarize my tasks for tonight?",
     "response": "Here are your current tasks...", "sentiment": "neutral", "hour": 23},
    {"role": "Sales Manager",    "message": "Any urgent deals I need to handle now?",
     "response": "Checking CRM for urgent items...", "sentiment": "neutral", "hour": 22},
    # Positive pair signals
    {"role": "CEO",              "message": "What are our Q3 priorities?",
     "response": "Based on your company context, Q3 focuses on: revenue growth, product launch, hiring.", "sentiment": "positive", "acted_on": True},
    {"role": "Sales Manager",    "message": "Who are our top clients by revenue?",
     "response": "Top clients this quarter: Client A ($120k), Client B ($85k), Client C ($72k).", "sentiment": "positive", "acted_on": True},
]


def main():
    client = db_module.db()

    # Get staff IDs for company A
    resp = client.table("staff").select("id, role").eq("company_id", COMPANY_A).execute()
    staff_rows = resp.data or []
    if not staff_rows:
        print("No staff found for company A. Run seed_company.py first.")
        return

    staff_by_role = {s["role"]: s["id"] for s in staff_rows}
    now = datetime.now(timezone.utc)

    inserted = 0
    for i, interaction in enumerate(SAMPLE_INTERACTIONS * 4):  # repeat to get volume
        role = interaction["role"]
        staff_id = staff_by_role.get(role) or staff_rows[i % len(staff_rows)]["id"]
        hour = interaction.get("hour", random.randint(8, 18))
        created_at = (now - timedelta(days=random.randint(0, 20), hours=random.randint(0, 12))).isoformat()

        resp = client.table("interactions").insert({
            "id":                  str(uuid.uuid4()),
            "company_id":          COMPANY_A,
            "staff_id":            staff_id,
            "role":                role,
            "user_message":        interaction["message"],
            "agent_response":      interaction["response"],
            "tools_called":        [],
            "suggestion_acted_on": interaction.get("acted_on"),
            "sentiment":           interaction.get("sentiment", "neutral"),
            "session_hour":        hour,
            "created_at":          created_at,
        }).execute()

        if resp.data and interaction.get("acted_on"):
            iid = resp.data[0]["id"]
            client.table("training_signals").insert({
                "company_id":     COMPANY_A,
                "interaction_id": iid,
                "kind":           "positive_pair",
                "prompt":         interaction["message"],
                "target":         interaction["response"],
                "score":          0.9,
            }).execute()
        inserted += 1

    print(f"Seeded {inserted} interactions and training signals for company A.")
    print("Run `python scripts/run_one_company.py` to test the fine-tune pipeline.")


if __name__ == "__main__":
    main()
