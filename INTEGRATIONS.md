# WorkDaemon — Integrations

Goal: match Zapier's breadth so any company can connect its tools, but as
**native OAuth connectors we own** — the daemon reads each company's real data
(and, at higher permission levels, acts on it). The Zapier app directory
(9,637 apps) is just our master to-build list; we never depend on Zapier, and
every connector is built against the **app's own OAuth/API**.

- **Full app list:** [`docs/integrations/CATALOG.md`](docs/integrations/CATALOG.md) — tick a box there when a connector ships.
- **This file:** the architecture + the **priority order** (popular/important apps first) with each app's own OAuth docs.

> The OAuth-docs links below are canonical entry points. Endpoints/scopes change —
> **read the app's live docs when you build that connector** (that's the source of truth, not this file or Zapier).

## Status legend
✅ Live · 🔨 In progress · 🔑 App credentials provisioned (client id/secret in env), not built · ⬜ Planned

---

## Architecture (how a connector works)

Constraints that shape this: Vercel **Hobby caps a deployment at 12 serverless
functions and `api/` is already at the cap** — so OAuth does **not** get a route
per provider. One route, many providers, driven by a registry.

1. **Provider registry** — `api/_lib/oauth_providers.js`: per provider →
   `{ authorizeUrl, tokenUrl, scopes, clientIdEnv, clientSecretEnv, pkce?, extra }`.
2. **One OAuth route** — `GET /api/oauth?action=start&provider=slack` → redirect to
   the provider's consent screen (state = signed workspace+user+nonce);
   `GET /api/oauth?action=callback&provider=slack&code=…` → exchange code → tokens →
   **encrypt at rest** with the existing AES-256-GCM (`encryptSecret`) → upsert into
   `workspace_integrations`. (Stays under the 12-fn cap — same pattern as the brain-scan cron.)
3. **Token store** — new table `workspace_integrations`:
   `workspace_id, provider, status, access_token(enc), refresh_token(enc),
   token_expires_at, scopes[], external_account, metadata jsonb, connected_by, created_at`.
   Auto-refresh on read when `token_expires_at` is near.
4. **Data layer** — `api/_lib/connectors/<provider>.js`: typed `read*`/`act*` helpers
   that call the app's API with the workspace's token (SSRF-safe, rate-limited).
5. **Daemon wiring** — connected providers feed `chat.js` (`TOOL_PERMISSIONS` →
   real tools): reads ground answers + the knowledge graph; writes go through the
   permission ladder (L2 `action_confirm` → L3 auto, same as L3 publishing).
6. **UI** — the `Integrations` page (currently a placeholder route) lists catalog
   apps with Connect/Disconnect, status, and scopes.

**Definition of Done** for a connector (what flips it to ✅ here *and* in the catalog):
connect + disconnect via OAuth; token refresh works; ≥1 real **read** that surfaces
to the daemon; app credentials in env (Prod+Preview); appears in the Integrations UI.

**Per-provider app credentials** (developer app client id/secret) live in env as
`<PROVIDER>_CLIENT_ID` / `<PROVIDER>_CLIENT_SECRET` (e.g. `SLACK_CLIENT_ID`). Track
provisioning with the 🔑 status.

---

## Priority — build these first

### P0 · Launch-critical (the daemon's core company data)
| App | Category | Auth | OAuth docs | Status |
|-----|----------|------|-----------|--------|
| Slack | Comms | OAuth2 | https://api.slack.com/authentication/oauth-v2 | 🔨 code done, needs creds |
| Gmail | Email | OAuth2 (Google) | https://developers.google.com/gmail/api/auth/scopes | ⬜ |
| Google Drive | Storage/Docs | OAuth2 (Google) | https://developers.google.com/drive/api/guides/about-auth | 🔨 connector+registry built · needs creds |
| Google Calendar | Calendar | OAuth2 (Google) | https://developers.google.com/calendar/api/auth | ⬜ |
| Google Sheets | Data | OAuth2 (Google) | https://developers.google.com/sheets/api/scopes | ⬜ |
| Notion | Docs/Wiki | OAuth2 | https://developers.notion.com/docs/authorization | 🔨 connector+registry built · needs creds |
| Microsoft Outlook | Email | OAuth2 (MS Graph) | https://learn.microsoft.com/en-us/graph/auth-v2-user | ⬜ |
| Microsoft Teams | Comms | OAuth2 (MS Graph) | https://learn.microsoft.com/en-us/graph/auth-v2-user | ⬜ |
| OneDrive / SharePoint | Storage | OAuth2 (MS Graph) | https://learn.microsoft.com/en-us/graph/auth-v2-user | ⬜ |
| GitHub | Dev | OAuth2 | https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps | 🔨 connector+registry built · needs creds |
| Jira | Project mgmt | OAuth2 3LO | https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/ | ⬜ |
| HubSpot | CRM | OAuth2 | https://developers.hubspot.com/docs/api/oauth-quickstart-guide | ⬜ |
| Salesforce | CRM | OAuth2 | https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_web_server_flow.htm&type=5 | ⬜ |

Google note: one Google Cloud OAuth client covers Gmail/Drive/Calendar/Sheets — differ only by **scopes**.
Microsoft note: one Entra app covers Outlook/Teams/OneDrive/Excel via **Microsoft Graph** scopes.
Atlassian note: one app covers Jira + Confluence + Trello (3LO).

### P1 · High value (broaden coverage)
| App | Category | Auth | OAuth docs | Status |
|-----|----------|------|-----------|--------|
| Microsoft Excel / Office 365 | Data | OAuth2 (MS Graph) | https://learn.microsoft.com/en-us/graph/auth-v2-user | ⬜ |
| Confluence | Docs/Wiki | OAuth2 3LO | https://developer.atlassian.com/cloud/confluence/oauth-2-3lo-apps/ | ⬜ |
| Asana | Project mgmt | OAuth2 | https://developers.asana.com/docs/oauth | ⬜ |
| Trello | Project mgmt | OAuth2 | https://developer.atlassian.com/cloud/trello/guides/rest-api/authorization/ | ⬜ |
| Linear | Project mgmt | OAuth2 | https://developers.linear.app/docs/oauth/authentication | ⬜ |
| ClickUp | Project mgmt | OAuth2 | https://clickup.com/api/developer-portal/authentication/ | ⬜ |
| monday.com | Project mgmt | OAuth2 | https://developer.monday.com/apps/docs/oauth | ⬜ |
| Zoom | Meetings | OAuth2 | https://developers.zoom.us/docs/integrations/oauth/ | ⬜ |
| Zendesk | Support | OAuth2 | https://developer.zendesk.com/documentation/ticketing/working-with-oauth/creating-and-using-oauth-tokens-with-the-api/ | ⬜ |
| Intercom | Support | OAuth2 | https://developers.intercom.com/docs/build-an-integration/learn-more/authentication/setting-up-oauth/ | ⬜ |
| Airtable | Data | OAuth2 | https://airtable.com/developers/web/guides/oauth-integrations | ⬜ |
| Dropbox | Storage | OAuth2 | https://developers.dropbox.com/oauth-guide | ⬜ |
| Box | Storage | OAuth2 | https://developer.box.com/guides/authentication/oauth2/ | ⬜ |
| Stripe | Payments/Finance | OAuth2 (Connect) | https://docs.stripe.com/connect/oauth-reference | ⬜ |
| QuickBooks Online | Accounting | OAuth2 | https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0 | ⬜ |
| Xero | Accounting | OAuth2 | https://developer.xero.com/documentation/guides/oauth2/overview/ | ⬜ |
| Mailchimp | Marketing | OAuth2 | https://mailchimp.com/developer/marketing/guides/access-user-data-oauth-2/ | ⬜ |
| Calendly | Scheduling | OAuth2 | https://developer.calendly.com/api-docs/ZG9jOjM5NjA0MzU3-oauth | ⬜ |
| Typeform | Forms | OAuth2 | https://www.typeform.com/developers/get-started/applications/ | ⬜ |
| Pipedrive | CRM | OAuth2 | https://developers.pipedrive.com/docs/api/v1/oauth-authorization | ⬜ |
| Shopify | E-commerce | OAuth2 | https://shopify.dev/docs/apps/auth/oauth | ⬜ |
| Discord | Comms | OAuth2 | https://discord.com/developers/docs/topics/oauth2 | ⬜ |
| LinkedIn | Social | OAuth2 | https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow | ⬜ |
| X (Twitter) | Social | OAuth2 | https://developer.twitter.com/en/docs/authentication/oauth-2-0 | ⬜ |
| Meta (Facebook/Instagram) | Social | OAuth2 | https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow | ⬜ |

### P2 · Next wave
GitLab · Bitbucket · Basecamp · Todoist · Google Meet · Webex · Freshdesk ·
Help Scout · Front · Twilio · SendGrid · Mailgun · PayPal · Square · Gusto ·
BambooHR · Greenhouse · Lever · Segment · Mixpanel · Amplitude ·
Google Analytics 4 · Webflow · WordPress · Zoho CRM · Zoho Books ·
Microsoft Dynamics 365 · ServiceNow · ActiveCampaign · Klaviyo · Notion-like
wikis · Coda · Smartsheet · Jotform · Google Forms · DocuSign · PandaDoc.

Everything else: [`docs/integrations/CATALOG.md`](docs/integrations/CATALOG.md).

---

## Build order checklist (foundation before connectors)
- [x] `workspace_integrations` table (encrypted tokens) + migration `migration_workspace_integrations.sql` (applied to prod)
- [x] Provider registry — `api/_lib/oauth.js` (`PROVIDERS`)
- [x] `/api/oauth` start + callback (HMAC-signed state, token exchange, encrypted store) — hosted in `api/workspace/settings.js` via a `vercel.json` rewrite (no new function)
- [x] Connector — `api/_lib/connectors/slack.js`: **32 Slack tools** (14 reads + 18 actions,
  parity with Zapier) + `SLACK_TOOLS` registry + `runSlackTool` dispatcher; dual bot/user
  tokens (`workspace_integrations.user_token`, encrypted) via `getAccessToken(…, kind)`
- [x] Integrations UI — Connect/Disconnect/status (`IntegrationsPage`, replaces the placeholder route)
- [x] Daemon awareness — connected tools injected into the chat system prompt (stops "no tools connected")
- [ ] Daemon **data ingestion** — Slack reads (channels/history) into daemon context / knowledge graph (next increment)
- [🔨] First connector end-to-end: **Slack** — code complete; **awaiting Slack app credentials** (see below)

## ▶ Flip Slack live (needs YOU — one-time)
1. Create a Slack app → https://api.slack.com/apps → "Create New App" (from scratch).
2. **OAuth & Permissions** → Redirect URLs → add: `https://workdaemon-prod.vercel.app/api/oauth`
   (and the preview URL if you use it). Save.
3. **Scopes** (for the full 32-tool connector — reads + actions):
   - **Bot Token Scopes:** `channels:read` `channels:history` `channels:manage`
     `groups:read` `groups:write` `groups:history` `im:read` `im:write` `im:history`
     `mpim:read` `mpim:history` `chat:write` `reactions:read` `reactions:write`
     `users:read` `users:read.email` `team:read` `reminders:write` `canvases:write`
   - **User Token Scopes:** `search:read` `users.profile:write` (needed for Find Message / Set Status / Update Profile)
4. Copy **Client ID** and **Client Secret** (Basic Information).
5. Set them in Vercel env (Production + Preview): `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`
   (tell Claude — it sets them via the Vercel API, like `CRON_SECRET`), then redeploy.
6. App → **Integrations** → Slack now shows **Connect** → consent → connected. Done → tick Slack in the catalog.

### ▶ Real-time (Events API) — for proactive alerts + brain learning
So the daemon reacts the moment something happens (you're @mentioned, a thread heats up) and the brain learns from the live stream:
1. **Basic Information → Signing Secret** → set `SLACK_SIGNING_SECRET` in Vercel (Prod+Preview).
   *(Must be set BEFORE step 3 — Slack signs the verification request.)*
2. Redeploy.
3. **Event Subscriptions** → toggle **On** → **Request URL:** `https://workdaemon-prod.vercel.app/api/slack/events`
   (Slack pings it; we answer the `url_verification` challenge → "Verified ✓").
4. **Subscribe to bot events:** `message.channels` (public), `message.groups` (private),
   `message.im`, `message.mpim`, `app_mention`. Save → reinstall the app to add the events scopes.
5. **Invite the bot** to the channels you want watched (`/invite @WorkDaemon`) — Slack only
   delivers events from channels the bot is in.
- Built: `api/_lib/connectors/slack_events.js` (signature-verified, fast-ack + `waitUntil`),
  hosted in `api/overview.js` (bodyParser off) via a `/api/slack/events` rewrite. Stores to
  `slack_messages`; @mentions → the mentioned member's inbox (resolved by email → `slack_user_map`).
- Next increment: **brain pulse** — periodic LLM over recent `slack_messages` → findings
  ("argument brewing in #engineering", "decision needed in #product") routed to the right roles.
