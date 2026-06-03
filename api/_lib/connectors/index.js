// Connector registry — maps a provider key to its ingest(db, workspaceId, token)
// data layer. Shared by the manual ingest action and the nightly auto-ingest cron.
import * as slack from './slack.js';
import * as github from './github.js';
import * as notion from './notion.js';
import * as gdrive from './gdrive.js';
import * as microsoft from './microsoft.js';
import * as atlassian from './atlassian.js';
import * as salesforce from './salesforce.js';
import * as hubspot from './hubspot.js';

export const CONNECTORS = {
  slack,            // folds slack_messages (webhook feed) into documents
  github,
  notion,
  google: gdrive,   // PROVIDERS key 'google' → Drive + Gmail + Calendar
  microsoft,        // Outlook mail (Graph)
  atlassian,        // Jira issues
  salesforce,       // Opportunities
  hubspot,          // Deals
};
