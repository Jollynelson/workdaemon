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

## Switching the embedding model/provider later
Change `EMBEDDINGS_MODEL` (and the Modal `ollama pull`), update the `vector(N)` dim in
a migration to match the new model, then run the reindex action. To move off Modal to a
hosted key, set `EMBEDDINGS_PROVIDER=openai|mistral` + `EMBEDDINGS_API_KEY` (+ matching dim).

## Sensitive tier (same Modal serving)
"Sensitive" reasoning routes to the Modal-served per-company model via the existing
`modal` provider (`api/chat.js` `case 'modal'`, base = serving URL). Add a workspace
key with provider `modal` + the serving base URL + the per-company bearer token to keep
those queries on our infra.
