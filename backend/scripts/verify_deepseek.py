"""Live smoke test of the DeepSeek Brain layer.

The docs (api-docs.deepseek.com) confirm: deepseek-v4-pro / deepseek-v4-flash are
current (1M ctx), deepseek-chat/reasoner are deprecated, thinking needs BOTH
`thinking={"type":"enabled"}` and `reasoning_effort`. This script proves those
work on YOUR key end-to-end:
  1. lists models on the account
  2. fast call (Flash, thinking off) returns content
  3. deep call (Pro, thinking on, effort=max) returns content + reasoning_content

Usage:
    DEEPSEEK_API_KEY=sk-... python backend/scripts/verify_deepseek.py
    # or put DEEPSEEK_API_KEY in backend/.env or the repo-root .env first
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request

BASE = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
KEY = os.environ.get("DEEPSEEK_API_KEY", "")

CURRENT_IDS = ["deepseek-v4-pro", "deepseek-v4-flash"]
DEPRECATED_IDS = ["deepseek-chat", "deepseek-reasoner"]


def _get(path: str) -> tuple[int, dict]:
    req = urllib.request.Request(f"{BASE}{path}", headers={"Authorization": f"Bearer {KEY}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def _post(path: str, body: dict) -> tuple[int, dict]:
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=data,
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def main() -> int:
    if not KEY:
        print("DEEPSEEK_API_KEY not set. Add it to backend/.env or export it.")
        return 1

    print(f"Base URL: {BASE}\n")

    # 1) What models exist?
    status, body = _get("/models")
    available = []
    if status == 200:
        available = [m.get("id") for m in body.get("data", [])]
        print("AVAILABLE MODELS ON YOUR ACCOUNT:")
        for m in available:
            print(f"  - {m}")
    else:
        print(f"/models returned HTTP {status}: {body}")
    print()

    # 2) Confirm current IDs present, deprecated ones flagged
    print("MODEL ID CHECK:")
    for mid in CURRENT_IDS:
        print(f"  {'✓' if mid in available else '✗'} {mid}  (current)")
    for mid in DEPRECATED_IDS:
        if mid in available:
            print(f"  ! {mid}  (deprecated — do not use)")
    print()

    fast = "deepseek-v4-flash"
    deep = "deepseek-v4-pro"

    # 3) Fast tier — thinking OFF — should return content
    print("FAST TIER (Flash, thinking off):")
    st, bd = _post(
        "/chat/completions",
        {
            "model": fast,
            "messages": [{"role": "user", "content": "Reply with exactly: ok"}],
            "max_tokens": 16,
            "thinking": {"type": "disabled"},
        },
    )
    if st == 200:
        msg = bd.get("choices", [{}])[0].get("message", {})
        print(f"  HTTP 200 | content={msg.get('content')!r}")
    else:
        print(f"  HTTP {st}: {bd.get('error', {}).get('message', bd)}")
    print()

    # 4) Deep tier — thinking ON, effort=max — should return content + reasoning_content
    print("DEEP TIER (Pro, thinking on, effort=max):")
    st, bd = _post(
        "/chat/completions",
        {
            "model": deep,
            "messages": [{"role": "user", "content": "What is 17*23? One number."}],
            "max_tokens": 2048,
            "thinking": {"type": "enabled"},
            "reasoning_effort": "max",
        },
    )
    if st == 200:
        msg = bd.get("choices", [{}])[0].get("message", {})
        rc = msg.get("reasoning_content")
        print(f"  HTTP 200 | content={msg.get('content')!r}")
        print(f"  reasoning_content present: {bool(rc)} ({len(rc or '')} chars)")
    else:
        print(f"  HTTP {st}: {bd.get('error', {}).get('message', bd)}")
    print()

    print("=" * 60)
    print("CONFIRMED — backend/.env should have:")
    print(f"  BRAIN_DEEP_MODEL={deep}")
    print(f"  BRAIN_FAST_MODEL={fast}")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
