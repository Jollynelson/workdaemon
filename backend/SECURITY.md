# WorkDaemon Backend — Security Posture

## Tenant isolation (how cross-company leakage is prevented)

**Primary enforcement: application-layer, service-role + `CompanyDB`.**
Every DB access goes through `CompanyDB(company_id)` which forces `company_id` on
every read (filter) and write (stamp). The backend uses the Supabase **service
role**. Identity is derived **server-side** from the Supabase auth token
(`resolve_identity`) — a client can never assert its own `company_id`. The
`test_isolation_gate.py` suite asserts no cross-company read/write/route/Brain-call
at every layer, and is a release gate.

**Second line (RLS): currently a no-op — documented honestly.**
RLS is *enabled* on all backend tables, but **no per-table policies are defined**,
and the service role bypasses RLS anyway. So RLS is NOT currently providing
defense-in-depth. This is safe TODAY because:
- nothing accesses these tables except the service-role backend, and
- the backend never trusts client-supplied company_id.

It would matter only if these tables were ever exposed to a non-service-role
client (e.g. the frontend querying Supabase directly with the anon key). The
backend does not do that. **If that ever changes, add per-company RLS policies
(check the requesting user's workspace membership) before exposing them.**

## Secrets
- All secrets live in Modal secrets (`workdaemon-backend-secret`,
  `workdaemon-serve-secret`) or the gitignored root `.env`. None in code or git
  (verified: no `.env` committed).
- Per-company integration tokens (Notion/Slack) are **encrypted at rest** with
  Fernet (`integrations/crypto.py`); the DB stores only ciphertext.
- `SERVE_MASTER_SECRET` gates the serving endpoint; per-company serve tokens are
  HMAC(master, company_id) so a leaked token unlocks only its own company.

## Resilience
- Outbound model calls (DeepSeek, serving) use `retry_call` — bounded exponential
  backoff with jitter on transient failures (429/5xx/timeout) only; client errors
  (4xx) are never retried.

## Known gaps before heavy production (tracked)
- RLS policies (above) — add if tables are ever client-exposed.
- Error monitoring (Sentry DSN) — wire when available.
- Rate-limit handling is per-call retry; a global token-budget/quota per company
  is not yet enforced (see billing/usage-metering task).
