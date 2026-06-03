# Platform Embeddings on Modal

Knowledge-base search (document grounding) runs on **our** infra so customers
only ever connect a **reasoning** key. Embeddings are served by Modal (Ollama +
`nomic-embed-text`, 768-dim), scale-to-zero. Configured once; every workspace uses it.

## Deploy (one-time)
```bash
# 1. Ensure the Modal secret exists (same master secret the serving app uses)
modal secret create workdaemon-serve-secret SERVE_MASTER_SECRET=<random-strong-secret>

# 2. Deploy the embeddings endpoint
modal deploy finetuning/modal/embeddings_app.py
#    → prints a URL like  https://<org>--workdaemon-embeddings-embeddings.modal.run
```

## Wire the Node app (Vercel env — Production + Preview)
```
EMBEDDINGS_PROVIDER=modal
MODAL_EMBEDDINGS_URL=<the https://…modal.run URL from deploy>
MODAL_SERVE_SECRET=<same value as SERVE_MASTER_SECRET>
EMBEDDINGS_MODEL=nomic-embed-text     # optional (default)
```

## Re-index existing documents
After the endpoint is live, embed everything already ingested:
```
POST /api/brain  { "action": "reindex" }   # admin; re-embeds workspace_documents
```
The nightly cron also re-embeds on ingest going forward.

## How it fits
- `api/_lib/ingestion.js` `embed()` → POSTs `{input,model}` to `MODAL_EMBEDDINGS_URL`
  with `Authorization: Bearer MODAL_SERVE_SECRET`; expects `{embeddings:[[...]],dim}`.
- DB column is `vector(768)` (`migration_embeddings_dim.sql`) to match nomic-embed-text.
- If the endpoint/env is absent or errors, retrieval **falls back to keyword** — the
  KB never breaks; it just isn't semantic until Modal embeddings are live.

## Switching to another platform later
Embeddings + the sensitive tier are **config, not code** — moving platforms is changing
env vars and running a re-index. `embed()` in `api/_lib/ingestion.js` already supports
four shapes; the env block lives in `.env.example` under "EMBEDDINGS"/"SENSITIVE TIER".

| Target platform | EMBEDDINGS_PROVIDER | Set these env vars | Dim | Re-index? |
|---|---|---|---|---|
| **Modal** (current default) | `modal` | `MODAL_EMBEDDINGS_URL`, `MODAL_SERVE_SECRET`, `EMBEDDINGS_MODEL=nomic-embed-text` | 768 | only if dim changes |
| **Self-host / VPS Ollama** | `ollama` | `MODAL_EMBEDDINGS_URL`=`http://<vps>:11434/api/embeddings`-style proxy, `EMBEDDINGS_MODEL` | match model | if dim changes |
| **OpenAI** | `openai` | `EMBEDDINGS_API_KEY`, `EMBEDDINGS_MODEL=text-embedding-3-small` | 1536 | yes (dim change) |
| **Mistral** | `mistral` | `EMBEDDINGS_API_KEY`, `EMBEDDINGS_MODEL=mistral-embed` | 1024 | yes (dim change) |
| **Any OpenAI-compatible** (Together, Voyage proxy, vLLM, future) | `openai` | `EMBEDDINGS_API_KEY`, **`EMBEDDINGS_OPENAI_BASE_URL`**=`https://host/v1`, `EMBEDDINGS_MODEL` | match model | if dim changes |

**The one gotcha is the vector dimension.** `workspace_documents.embedding` is `vector(768)`
(nomic). A model with a different dim (OpenAI=1536, Mistral=1024) needs a migration that
alters that column AND the `match_documents` RPC signature to the new N, then a full
re-index. Same-dim swaps (another 768-dim model) need only a re-index. Always re-index
after any model change so old and new vectors aren't compared in the same space:
```
POST /api/brain  { "action": "reindex" }
```
If you skip the migration on a dim change, inserts fail and retrieval silently falls back
to keyword — the KB keeps working, just not semantically, until the dim is reconciled.

## Sensitive tier (keep reasoning on our own infra)
"Sensitive" reasoning routes to a private LLM **we** run instead of a hosted API, so
those queries never leave our infra. Today that's the Modal-served per-company model via
the existing `modal` provider (`api/chat.js` `case 'modal'`, base = serving URL). Add a
workspace key with provider `modal` + the serving base URL + the per-company bearer token.

To switch the sensitive tier to a different private host later (a VPS, an on-prem box):
- Point the workspace's `modal` provider key at the new serving base URL + bearer, **or**
- Set the platform defaults `SENSITIVE_SERVE_URL` + `SENSITIVE_SERVE_SECRET` in env
  (see `.env.example`) and have `case 'modal'` fall back to them when a workspace hasn't
  set its own. The contract is OpenAI-compatible chat completions, so any vLLM/Ollama/
  TGI server works — switching is the same config-flip pattern as embeddings above.

> The roadmap note from the user: embeddings + sensitive both run on Modal now; **a VPS
> upgrade is a likely later move.** Both surfaces are deliberately env-configurable so
> that move is a redeploy with new URLs, not a code change.
