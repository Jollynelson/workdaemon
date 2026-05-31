"""Mint the per-company serve token for a workspace's "Company Brain (Hermes-3)"
provider config (paste the output as the provider api_key in Settings).

The token is HMAC-SHA256(SERVE_MASTER_SECRET, company_id) — it only authorizes
that one company_id. Requires SERVE_MASTER_SECRET (from the root .env or env).

Usage:
    python scripts/mint_serve_token.py <company_id>
"""

from __future__ import annotations

import sys

from src.api.auth import company_token
from src.config import settings


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: python scripts/mint_serve_token.py <company_id>", file=sys.stderr)
        return 2
    if not settings.serve_master_secret:
        print("SERVE_MASTER_SECRET is not set (add it to the root .env).", file=sys.stderr)
        return 1
    print(company_token(sys.argv[1]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
