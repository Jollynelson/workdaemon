"""Apply a SQL migration to Supabase/Postgres over DATABASE_URL.

Handles passwords with special chars (parses the URL rather than passing a DSN)
and runs statements individually so one failure doesn't abort the batch. Keeps
`do $$ ... $$` blocks intact.

Usage:
    python backend/scripts/apply_migration.py backend/migrations/001_init.sql
"""

from __future__ import annotations

import sys
from urllib.parse import unquote, urlparse

import psycopg2
from dotenv import dotenv_values


def _conn():
    v = dotenv_values("/Users/mac/workdaemon/.env")
    raw = v.get("DATABASE_URL_UNPOOLED") or v.get("DATABASE_URL")
    if not raw:
        raise SystemExit("DATABASE_URL not set")
    u = urlparse(raw)
    c = psycopg2.connect(
        host=u.hostname, port=u.port or 5432,
        user=unquote(u.username or ""), password=unquote(u.password or ""),
        dbname=(u.path or "/postgres").lstrip("/") or "postgres", sslmode="require",
    )
    c.autocommit = True
    return c


def _split(sql: str) -> list[str]:
    """Split on ';' at top level, but keep dollar-quoted ($$...$$) blocks whole."""
    out, buf, in_dollar = [], [], False
    for line in sql.splitlines():
        if "$$" in line:
            in_dollar = not in_dollar if line.count("$$") % 2 else in_dollar
        buf.append(line)
        if line.rstrip().endswith(";") and not in_dollar:
            out.append("\n".join(buf))
            buf = []
    if buf:
        out.append("\n".join(buf))
    return [s.strip() for s in out if s.strip() and not s.strip().startswith("--")]


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: apply_migration.py <file.sql>")
        return 2
    sql = open(sys.argv[1]).read()
    conn = _conn()
    ok = fail = 0
    for stmt in _split(sql):
        try:
            with conn.cursor() as cur:
                cur.execute(stmt)
            ok += 1
        except Exception as e:
            fail += 1
            print(f"  ! {str(e)[:120]}  :: {stmt[:60].replace(chr(10),' ')}...")
    conn.close()
    print(f"done: {ok} ok, {fail} failed")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
