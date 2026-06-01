"""Live end-to-end dry run against real Supabase + DeepSeek.

Validates the backend wiring with live services (no fakes):
  1. seed a company + staff (company-scoped CompanyDB)
  2. spin up the staff member's agent
  3. real chat turn → DeepSeek Flash → logged interaction + activity event
  4. run a threat hunt → real DeepSeek finding → (maybe) push

Cleans up the seeded company at the end. Idempotent-ish: uses a fixed dry-run slug.

Usage: python backend/scripts/dry_run.py
"""

from __future__ import annotations

import sys
import uuid

sys.path.insert(0, "/Users/mac/workdaemon/backend")

from dotenv import load_dotenv

load_dotenv("/Users/mac/workdaemon/.env")

from src.agents.factory import AgentFactory          # noqa: E402
from src.agents.runtime import DeepSeekAgentModel    # noqa: E402
from src.agents.tools import ToolExecutor            # noqa: E402
from src.api.chat_service import ChatService         # noqa: E402
from src.brain.activity_feed import ActivityFeed     # noqa: E402
from src.brain.hunter import HuntEngine              # noqa: E402
from src.brain.logger import InteractionLogger       # noqa: E402
from src.brain.router import default_router          # noqa: E402
from src.config import settings                      # noqa: E402
from src.db import CompanyDB, supabase_client        # noqa: E402
from src.push.inbox import PushInbox                 # noqa: E402


def main() -> int:
    sb = supabase_client()
    slug = f"dryrun-{uuid.uuid4().hex[:8]}"

    # 1. seed company + staff
    company = sb.table("companies").insert({"name": "DryRun Co", "slug": slug}).execute().data[0]
    cid = company["id"]
    db = CompanyDB(cid, client=sb)
    staff = db.insert("staff", {"name": "Sam Rivera", "email": f"{slug}@x.co",
                                "role": "Sales Manager", "department": "Sales",
                                "access_level": "manager"})
    print(f"[1] seeded company={cid[:8]} staff={staff['id'][:8]}")

    try:
        # 2. spin up agent
        factory = AgentFactory(db, "DryRun Co")
        profile = factory.spin_up(staff)
        print(f"[2] agent spun up: tools={profile.permitted_tools}")

        # 3. real chat turn via DeepSeek Flash
        svc = ChatService(
            factory=factory,
            model=DeepSeekAgentModel(settings.deepseek_api_key, settings.deepseek_base_url,
                                     settings.brain_fast_model),
            feed=ActivityFeed(db),
            logger=InteractionLogger(db),
            build_executor=lambda lvl: ToolExecutor(lvl),
            pending_tasks_fn=lambda sid: PushInbox(db).pending_for(sid),
        )
        reply = svc.handle_turn(staff["id"], "In one sentence, what should I focus on as a sales manager today?")
        print(f"[3] chat reply ({len(reply.text)} chars): {reply.text[:160]}")
        print(f"    interaction_id={reply.interaction_id}")

        # 4. real threat hunt via DeepSeek
        push = PushInbox(db)
        hunt = HuntEngine(
            db, default_router(), ActivityFeed(db),
            assemble_context=lambda mode: (
                "Sales pipeline: Client Acme renewal in 45 days, no contact in 18 days. "
                "Two reps asked about Acme this week. Competitor just raised a round."),
            push=push,
            resolve_target=lambda role: staff["id"],
        )
        res = hunt.run_hunt("threat")
        print(f"[4] threat hunt: {len(res.findings)} finding(s) via {res.depth} tier")
        for f in res.findings[:3]:
            print(f"    - {f.get('title')} (conf {f.get('confidence')})")
        pend = push.pending_for(staff["id"])
        print(f"    pushes generated: {len(pend)}")

        print("\n✅ DRY RUN PASSED — live Supabase + DeepSeek end-to-end works.")
        return 0
    finally:
        # cleanup (cascades to staff/agent_profiles/interactions/etc.)
        sb.table("companies").delete().eq("id", cid).execute()
        print(f"[cleanup] removed company {cid[:8]}")


if __name__ == "__main__":
    sys.exit(main())
