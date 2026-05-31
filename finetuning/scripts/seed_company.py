"""
Seed two fake companies with staff members for testing.

Creates: companies, staff, agent_profiles (via factory.spin_up).
Run: python scripts/seed_company.py
"""

from __future__ import annotations

import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import src.db as db_module

COMPANIES = [
    {
        "id": "aaaaaaaa-0001-0001-0001-000000000001",
        "name": "Acme Corp",
        "slug": "acme-corp",
        "tier": "pro",
    },
    {
        "id": "bbbbbbbb-0002-0002-0002-000000000002",
        "name": "Beta Corp",
        "slug": "beta-corp",
        "tier": "pro",
    },
]

STAFF_TEMPLATES = [
    {"name": "Alice CEO",   "email": "alice@{slug}.test",   "role": "CEO",             "department": "Executive", "access_level": "executive"},
    {"name": "Bob Sales",   "email": "bob@{slug}.test",     "role": "Sales Manager",   "department": "Sales",     "access_level": "manager"},
    {"name": "Carol HR",    "email": "carol@{slug}.test",   "role": "HR Director",     "department": "HR",        "access_level": "director"},
    {"name": "Dave Junior", "email": "dave@{slug}.test",    "role": "Junior Developer","department": "Engineering","access_level": "junior"},
]


def main():
    client = db_module.db()

    for company in COMPANIES:
        print(f"\nSeeding company: {company['name']} ({company['id']})")

        # Upsert company
        client.table("companies").upsert(company, on_conflict="id").execute()

        # Create staff + spin up agents
        from src.agents.factory import AgentFactory
        factory = AgentFactory(company["id"], company["name"], client)

        for tmpl in STAFF_TEMPLATES:
            staff_data = {
                "id":           str(uuid.uuid4()),
                "company_id":   company["id"],
                "name":         tmpl["name"],
                "email":        tmpl["email"].format(slug=company["slug"]),
                "role":         tmpl["role"],
                "department":   tmpl["department"],
                "access_level": tmpl["access_level"],
            }

            try:
                client.table("staff").insert(staff_data).execute()
                factory.spin_up(staff_data)
                print(f"  ✓ {staff_data['name']} ({staff_data['role']}) — agent spun up")
            except Exception as exc:
                print(f"  ✗ {staff_data['name']}: {exc}")

    print("\nDone. Two companies seeded with 4 staff each.")


if __name__ == "__main__":
    main()
