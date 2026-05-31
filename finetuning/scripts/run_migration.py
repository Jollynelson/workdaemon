"""Run the Company Brain SQL migrations against the Postgres instance.

Usage:
    DATABASE_URL=postgres://... python scripts/run_migration.py
    DATABASE_URL=postgres://... python scripts/run_migration.py --drop-legacy

By default applies 001 (legacy finetuning tables) and 002 (canonical Company
Brain schema). The legacy tables are harmless to keep, so 003 (which DROPS them)
only runs with the explicit --drop-legacy flag.
"""

import argparse
import os
import sys
from pathlib import Path

import psycopg2

MIGRATIONS_DIR = Path(__file__).parent.parent / "migrations"

DEFAULT_MIGRATIONS = [
    "001_finetuning_tables.sql",
    "002_company_brain_schema.sql",
]
# Destructive; lives in migrations/optional/ so docker initdb never auto-runs it.
LEGACY_DROP_MIGRATION = "optional/003_drop_legacy_tables.sql"


def _apply(cur, filename: str) -> None:
    path = MIGRATIONS_DIR / filename
    if not path.exists():
        print(f"SKIP (not found): {filename}")
        return
    cur.execute(path.read_text())
    print(f"Applied: {filename}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply Company Brain migrations.")
    parser.add_argument(
        "--drop-legacy",
        action="store_true",
        help="Also apply 003, which DROPS the legacy workspaces/query_logs/"
             "feedback_signals/self_critiques/company_terminology tables. Destructive.",
    )
    args = parser.parse_args()

    url = os.environ.get("DATABASE_URL")
    if not url:
        print("ERROR: DATABASE_URL env var is not set", file=sys.stderr)
        sys.exit(1)

    migrations = list(DEFAULT_MIGRATIONS)
    if args.drop_legacy:
        print("--drop-legacy set: legacy tables will be DROPPED after migration 002.")
        migrations.append(LEGACY_DROP_MIGRATION)

    conn = psycopg2.connect(url)
    try:
        with conn.cursor() as cur:
            for filename in migrations:
                _apply(cur, filename)
        conn.commit()
        print("\nAll migrations applied successfully.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
