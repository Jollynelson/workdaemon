// Gmail connector — ingest the connected account's mail threads into the document
// store. Email is interaction-rich (decisions, commitments, customer/vendor threads),
// so it helps the per-company model beyond what RAG-over-static-docs can.
// SOURCE-trust: a corporate domain (not a free provider) confirms a real company
// account; a personal mailbox is still ingested for RAG/all-seeing but kept OUT of
// training (train_eligible=false). Ready; runs once the Google OAuth grants
// gmail.readonly and a workspace connects.
import { upsertDocuments } from '../ingestion.js';

const G = 'https://gmail.googleapis.com/gmail/v1/users/me';
const H = (t) => ({ Authorization: `Bearer ${t}`, Accept: 'application/json' });
const MAX_THREADS = Number(process.env.GMAIL_MAX_THREADS || 40);
// Free/personal providers → not a company source (ingest for RAG, don't train).
const FREE_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'ymail.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me',
  'protonmail.com', 'pm.me', 'gmx.com', 'mail.com', 'zoho.com',
]);

async function gJson(url, token) {
  const r = await fetch(url, { headers: H(token) });
  if (!r.ok) throw new Error(`gmail http ${r.status} (${url.replace(G, '')})`);
  return r.json();
}

function header(headers, name) {
  return (headers || []).find(h => (h.name || '').toLowerCase() === name)?.value || '';
}

// Pull text/plain (preferred) from a MIME payload, recursively.
function bodyText(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    try { return Buffer.from(payload.body.data, 'base64url').toString('utf8'); } catch { return ''; }
  }
  for (const p of payload.parts || []) {
    const t = bodyText(p);
    if (t) return t;
  }
  if (payload.body?.data) { try { return Buffer.from(payload.body.data, 'base64url').toString('utf8'); } catch { /* ignore */ } }
  return '';
}

export function domainOf(email) {
  const m = String(email || '').toLowerCase().match(/@([a-z0-9.-]+)/);
  return m ? m[1] : '';
}

// SOURCE-trust verdict for a connected mailbox: a corporate domain → company account.
export function isCompanyMailbox(emailAddress) {
  const d = domainOf(emailAddress);
  return !!d && !FREE_DOMAINS.has(d);
}

export async function ingest(db, workspaceId, token, { onProgress } = {}) {
  onProgress?.({ stage: 'reading mailbox', done: 0, total: 1 });
  const profile = await gJson(`${G}/profile`, token);
  const acctDomain = domainOf(profile.emailAddress);
  // Exclude promotions/social/spam/trash noise from the corpus up front.
  const q = encodeURIComponent('-category:promotions -category:social -in:spam -in:trash');
  const listed = await gJson(`${G}/threads?maxResults=${MAX_THREADS}&q=${q}`, token);
  const threads = listed.threads || [];

  const docs = [];
  for (let i = 0; i < threads.length; i++) {
    let th;
    try { th = await gJson(`${G}/threads/${threads[i].id}?format=full`, token); }
    catch { continue; }   // one bad thread never blocks the rest
    const msgs = th.messages || [];
    if (!msgs.length) continue;
    const h0 = msgs[0].payload?.headers || [];
    const subject = header(h0, 'subject') || '(no subject)';
    const lines = [];
    for (const m of msgs) {
      const from = header(m.payload?.headers || [], 'from');
      const body = bodyText(m.payload).replace(/\r/g, '').trim().slice(0, 4000);
      if (body) lines.push(`${from}: ${body}`);
    }
    if (!lines.length) continue;
    docs.push({
      external_id: `thread-${th.id}`,
      doc_type: 'email_thread',
      title: subject.slice(0, 200),
      content: lines.join('\n\n'),
      author: header(h0, 'from') || null,
      metadata: {
        participants: [...new Set(msgs.map(m => header(m.payload?.headers || [], 'from')).filter(Boolean))],
        messages: msgs.length,
      },
    });
    onProgress?.({ stage: 'reading mail threads', done: i + 1, total: threads.length, doc_count: docs.length });
  }

  const trainEligible = isCompanyMailbox(profile.emailAddress);
  onProgress?.({ stage: 'indexing', done: threads.length, total: threads.length, doc_count: docs.length });
  return upsertDocuments(db, workspaceId, 'gmail', docs, { trainEligible });
}
