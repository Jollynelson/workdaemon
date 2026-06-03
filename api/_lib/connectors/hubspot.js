// HubSpot connector — CRM deals into the document store. Ready; needs HUBSPOT creds.
import { upsertDocuments } from '../ingestion.js';

export async function ingest(db, workspaceId, token) {
  const r = await fetch('https://api.hubapi.com/crm/v3/objects/deals?limit=30&properties=dealname,dealstage,amount,closedate', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`hubspot deals http ${r.status}`);
  const d = await r.json();
  const docs = (d.results || []).map(x => ({
    external_id: `hsdeal-${x.id}`, doc_type: 'deal', title: x.properties?.dealname || 'Deal',
    content: `Deal ${x.properties?.dealname || ''} — stage ${x.properties?.dealstage || ''}, amount ${x.properties?.amount || ''}`,
    metadata: { stage: x.properties?.dealstage, amount: x.properties?.amount },
  }));
  return upsertDocuments(db, workspaceId, 'hubspot', docs);
}
