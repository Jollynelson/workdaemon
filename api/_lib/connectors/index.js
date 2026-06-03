// Connector registry — maps a provider key to its ingest(db, workspaceId, token)
// data layer. Shared by the manual ingest action and the nightly auto-ingest cron.
import * as github from './github.js';
import * as notion from './notion.js';
import * as gdrive from './gdrive.js';

export const CONNECTORS = {
  github,
  notion,
  google: gdrive,   // PROVIDERS key 'google' (Drive) → gdrive connector
};
