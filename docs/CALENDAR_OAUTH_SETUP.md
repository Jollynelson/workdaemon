# Calendar OAuth setup

The unified Calendar (Google + Microsoft + Notion) reads events through the
existing per-workspace OAuth framework (`api/_lib/oauth.js`). Each provider needs
a `*_CLIENT_ID` + `*_CLIENT_SECRET` set on Vercel (Production **and** Preview),
and a redirect URI registered in that provider's console.

**Redirect URI (same for all three):** `https://app.workdaemon.com/api/oauth`
(for Preview deploys, also add the preview URL's `/api/oauth`.)

## Google Calendar
- Console: https://console.cloud.google.com → APIs & Services → Credentials → OAuth client (Web).
- Enable the **Google Calendar API** (and Gmail/Drive if using those connectors).
- Authorized redirect URI: `https://app.workdaemon.com/api/oauth`
- Scopes are already requested in code (`calendar.readonly`, `calendar.events`).
- Vercel env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

## Microsoft 365 (Outlook calendar)
- Console: https://portal.azure.com → Microsoft Entra ID → App registrations → New registration.
- Redirect URI (Web): `https://app.workdaemon.com/api/oauth`
- API permissions (delegated): `Calendars.Read`, `User.Read`, `offline_access`.
- Create a client secret under Certificates & secrets.
- Vercel env: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`
  (and `MICROSOFT_TENANT` if you scope to a single tenant; defaults to `common`).

## Notion (database-as-calendar)
- Console: https://www.notion.so/my-integrations → New integration → Public (OAuth).
- Redirect URI: `https://app.workdaemon.com/api/oauth`
- Vercel env: `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`
- Notion has **no calendar API**. The connector reads the first shared database
  that has a Date property and treats dated rows as events. To pin a specific
  database, set `meta.calendar_database_id` on the workspace's `notion` row in
  `workspace_integrations` (the connect flow uses the first DB found otherwise).

## Verify
After adding creds + redeploy, the **Calendar** tab's "Connect" buttons run the
consent flow; on return the provider shows `· connected` and events populate.
If a provider isn't configured, the button alerts gracefully (nothing breaks).
