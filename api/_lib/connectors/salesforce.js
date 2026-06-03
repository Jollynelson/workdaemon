// Salesforce connector — recent Opportunities into the document store. Uses the
// per-connection instance_url stored at connect time. Ready; needs SALESFORCE creds.
import { upsertDocuments } from '../ingestion.js';

export async function ingest(db, workspaceId, token) {
  const { data } = await db.from('workspace_integrations').select('metadata').eq('workspace_id', workspaceId).eq('provider', 'salesforce').single();
  const instance = data?.metadata?.instance_url;
  if (!instance) throw new Error('salesforce: no instance_url');
  const soql = encodeURIComponent('SELECT Id,Name,StageName,Amount,CloseDate FROM Opportunity ORDER BY LastModifiedDate DESC LIMIT 30');
  const r = await fetch(`${instance}/services/data/v59.0/query?q=${soql}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`salesforce query http ${r.status}`);
  const d = await r.json();
  const docs = (d.records || []).map(o => ({
    external_id: `sfopp-${o.Id}`, doc_type: 'opportunity', title: o.Name,
    content: `Opportunity ${o.Name} — stage ${o.StageName}, amount ${o.Amount || 'n/a'}, close ${o.CloseDate || 'n/a'}`,
    metadata: { stage: o.StageName, amount: o.Amount },
  }));
  return upsertDocuments(db, workspaceId, 'salesforce', docs);
}
