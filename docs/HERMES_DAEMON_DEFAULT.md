# Daemons always run Hermes

Goal: every company's daemons run on the **Hermes agent** by default — the
conversational daemon (`api/chat.js`), the autonomous daemons + brain synthesis
(`api/_lib/research.js` → `resolveLLM`/`callLLM`), all of it.

## How it works (already in code)

Both engines are **Hermes-first**. When a workspace has no explicit provider key,
they route to the **shared Hermes gateway**, gated on two env vars:

| Env var | Meaning |
|---|---|
| `HERMES_SHARED_GATEWAY_URL` | OpenAI-compatible base URL of the shared Hermes gateway |
| `HERMES_SHARED_API_KEY` | Auth key for that gateway |
| `HERMES_SHARED_MODEL` | (optional) model id, default `hermes-agent` |

- **Set on Vercel (Prod + Preview)** → every keyless company's daemons run Hermes automatically. No per-company deploy or DB row.
- **Not set** → daemons fall back to DeepSeek/cloud (today's behavior — that's why they currently run DeepSeek).
- A company with its own `hermes` provider row in `workspace_api_keys` (e.g. a dedicated gateway) overrides the shared one.

So **"daemons always run Hermes" = set those two env vars + keep the gateway warm.**

## Resilience (deliberate — do not remove without deciding)

If the Hermes gateway errors or cold-starts, both engines **fall back to a cloud
model** so daemons never hard-fail:
- `chat.js`: `cloudFallback` after a Hermes error.
- `research.js` `callLLM` `case 'hermes'`: falls back to DeepSeek on failure.

This matters because of the known Hermes **cold-start (~60–90s)** vs the chat
function's timeout. Keep the gateway warm (prewarm/min-instances) to avoid leaning
on the fallback.

### Strict mode (optional)
If you want **Hermes or nothing** (no cloud fallback ever), remove the fallback
branches above. Not recommended until the gateway has reliable warm capacity —
otherwise a cold start = a failed daemon turn.

## What's still operational (yours, not code)
1. Deploy/keep-warm the shared Hermes gateway.
2. Set the 3 env vars on Vercel.
3. (Optional) per-company dedicated gateways via a `hermes` row in `workspace_api_keys`.

The Brain Skill Library is provider-agnostic, so skills already flow to Hermes —
injected into prompts AND served over the MCP surface (`?action=mcp&tool=list_skills|get_skill`).
