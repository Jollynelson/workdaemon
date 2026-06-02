# WorkDaemon — Security Posture (Vercel app: `api/` + `src/`)

This covers the **deployed Vercel app** (serverless functions in `api/` and the
React SPA in `src/`). The Python services have their own doc in
[`backend/SECURITY.md`](backend/SECURITY.md).

## Authentication & tenant isolation (no IDOR / BOLA)
- Every `api/` handler authenticates via `requireAuth` → `supabase.auth.getUser(token)`.
  The client only ever sends the Supabase access token; it **never** asserts its own
  `user_id` / `workspace_id` (those are resolved server-side from the token).
  Audited: no handler reads `user_id`/`workspace_id` from `req.body`/`req.query`.
- Handlers use the **service-role** client (`adminClient`) which bypasses RLS, so
  authorization is enforced **in code**: each query is scoped by the caller's
  resolved `workspace_id`, and admin-only actions check `workspace_members.role`.
- **Every client-supplied row id** (hunt-finding id, API-key id, `keyId`) is paired
  with `.eq('workspace_id', workspaceId)`, so a logged-in user cannot read or
  mutate another tenant's rows by guessing IDs. `target_user_id` (agent updates)
  is membership-checked and admin-only.
- RLS is also enabled on all tables (defense-in-depth) so the anon-key frontend
  path is constrained even if it queried Supabase directly.

## Input validation (OWASP A03 / strict allow-list)
- `validateBody(body, schema)` in `api/_lib/security.js` enforces, per field:
  presence of required fields, **type checks**, **length/range limits**,
  enum/pattern constraints, array item types — and **rejects unexpected fields**
  by default (strict allow-list). Applied to login, signup, user/setup, invites,
  chat, and the settings/brain action bodies; all return graceful `400`s.

## Prompt-injection defense (OWASP LLM01)
- The end-user's message stays in **user position** in the `messages` array — it
  never occupies the system-prompt instruction slot.
- All content that is user-, web-, or memory-derived and *does* get embedded in a
  system prompt (company context, stored memories, hunt-finding patterns, and the
  web-research snippets in role/company research) is wrapped by `delimitUntrusted`
  in clear `«UNTRUSTED_INPUT»…«/UNTRUSTED_INPUT»` markers, with the boundary
  sentinels stripped from the content so it can't break out.
- `UNTRUSTED_DATA_NOTICE` is prepended to those system prompts instructing the
  model to treat delimited blocks as data only and never obey instructions inside.
- Identity fields (name/title/company/industry/size/role) are collapsed to a
  single sanitized line before interpolation. The cross-user vector (one user's
  message → hunt finding → every member's daemon prompt) is specifically delimited.

## Controls implemented in the `api/` layer (`api/_lib/security.js`)
- **SSRF guard** (`assertSafeUrl`): every user-controlled outbound endpoint
  (ollama / azure / modal providers, model-list proxy) is validated — https only
  (http allowed for ollama), no embedded creds, and the host is DNS-resolved and
  rejected if it lands on a loopback / private / link-local / unique-local /
  CGNAT / cloud-metadata address (IPv4 + IPv6, incl. `169.254.169.254`).
- **Secrets at rest** (`encryptSecret` / `decryptSecret`): provider API keys in
  `workspace_api_keys.api_key` are AES-256-GCM encrypted with `ENCRYPTION_KEY`.
  Decryption is backward-compatible (legacy plaintext rows pass through), so the
  one-off migration `scripts/encrypt_api_keys.mjs` can be run any time.
- **Rate limiting on every public endpoint** (`rateLimit` via Upstash REST,
  in-memory fallback; IP-based for unauthenticated, user-based for authenticated;
  graceful `429` + `Retry-After`): login (IP + email), signup (IP), slug-check
  (IP); chat, brain, settings, me, overview, tasks, inbox, invite, user/setup
  (per user); plus stricter inner limits on role/company research, key validate,
  and the model proxy. Fixed-window; fails open only if all backends error.
- **Privilege escalation closed**: `update_agent` (which sets `access_level` /
  `permitted_tools` — the daemon's authorization surface) is admin-only and
  verifies the target is a member of the admin's workspace. Users can no longer
  raise their own access level.
- **Input validation**: email format + batch caps on invites; password length
  on signup; `access_level` allow-list; slug charset.
- **Generic error responses** (`fail`): DB / provider errors are logged
  server-side but never returned verbatim to the client (no schema/stack leak).

## Frontend
- `Md` renderer escapes all model output (React text nodes; only `**bold**` is
  parsed) — no `dangerouslySetInnerHTML` / `innerHTML` anywhere in `src/`.
- Auth token kept in `sessionStorage` (cleared on tab close), sent as a Bearer
  header. No tokens in `localStorage`.
- **Security headers** (`vercel.json`): CSP (`script-src 'self'`, no inline JS),
  HSTS (preload), `X-Frame-Options: DENY` + `frame-ancestors 'none'`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`,
  COOP.

## Known gaps / follow-ups
- Run `scripts/encrypt_api_keys.mjs --apply` once against prod to encrypt any
  keys saved before this change (new/edited keys are already encrypted).
- Rate limiting is fixed-window and best-effort; move to a sliding window or a
  WAF rule if abuse is observed.
- CSP `connect-src` allows `https:`/`wss:` broadly (Supabase URL is env-dynamic);
  tighten to explicit origins once they're stable.
- No CSRF tokens — APIs are Bearer-token (not cookie) authenticated, so they are
  not CSRF-able from a browser; keep it that way (don't switch to cookie auth
  without adding CSRF protection).
