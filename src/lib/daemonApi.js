// Extracted from the former 5,000-line src/pages/Dashboard.jsx (2026-06-10 split).


export function serializeDaemonMsg(msg) {
  if (msg.role === 'user') return { role: 'user', content: msg.text || '' };
  const content = msg.blocks
    ? JSON.stringify({ blocks: msg.blocks })
    : (msg.text || '');
  return { role: 'assistant', content };
}

export function parseJsonResponse(text) {
  if (!text) return { blocks: [], suggestions: [] };
  // Strip <thinking> tags (extended thinking models)
  let t = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
  // 1. Direct parse
  try { const p = JSON.parse(t); if (p.blocks) return p; } catch {}
  // 2. Code fence
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) { try { const p = JSON.parse(fence[1].trim()); if (p.blocks) return p; } catch {} }
  // 3. Balanced brace scan — first complete JSON object that has "blocks"
  let depth = 0, start = -1;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '{') { if (depth === 0) start = i; depth++; }
    else if (t[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        try { const p = JSON.parse(t.slice(start, i + 1)); if (p.blocks) return p; } catch {}
        start = -1;
      }
    }
  }
  // 4. Fallback: show raw text
  return { blocks: [{ type: 'text', md: text }], suggestions: [] };
}

// The system prompt is built SERVER-side (api/_lib/prompt.js) from the
// authenticated session — the client only sends messages + the auth token.
// (A legacy direct-browser Anthropic path with a client-built prompt was
// removed here: it bypassed every server-side defense and nothing set its key.)
export async function callDaemonAPI({ messages, authToken }) {
  // New FINAL-spec Brain backend (DeepSeek), when configured. Identity is derived
  // server-side from the auth token, so we only send the latest message + history.
  const brainUrl = (import.meta.env.VITE_BRAIN_API_URL || '').replace(/\/$/, '');
  if (brainUrl) {
    const serialized = messages.map(serializeDaemonMsg);
    const last = serialized[serialized.length - 1];
    const res = await fetch(`${brainUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({
        message: typeof last?.content === 'string' ? last.content : (last?.content ?? ''),
        history: serialized.slice(0, -1),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || data.error || `Server error ${res.status}`);
    // Backend returns rich {blocks, suggestions}; fall back to a text block.
    return {
      blocks: data.blocks?.length ? data.blocks : [{ type: 'text', md: data.text || '' }],
      suggestions: data.suggestions || [],
    };
  }

  // Legacy backend endpoint (old /api/chat on the same origin)
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({
      messages: messages.map(serializeDaemonMsg),
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error ${res.status}`);
  }
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// CHAT VIEW
// ─────────────────────────────────────────────────────────────────────────────

// Recover a daemon envelope that the model emitted as incomplete/unclosed JSON
// (it then got stored as a raw text block). Mirrors the backend's repair so old
// messages and any edge case render as real blocks instead of raw JSON text.
export function recoverDaemonEnvelope(md) {
  if (typeof md !== 'string' || !md.trimStart().startsWith('{') || !md.includes('"blocks"')) return null;
  try { const p = JSON.parse(md); if (p && Array.isArray(p.blocks)) return p.blocks; } catch {}
  let s = md.slice(md.indexOf('{'));
  for (let a = 0; a < 5 && s.length > 1; a++) {
    let inStr = false, esc = false; const st = [];
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true; else if (ch === '{' || ch === '[') st.push(ch); else if (ch === '}' || ch === ']') st.pop();
    }
    let r = inStr ? s + '"' : s; r = r.replace(/[,:]\s*$/, '');
    for (let i = st.length - 1; i >= 0; i--) r += st[i] === '{' ? '}' : ']';
    try { const p = JSON.parse(r); if (p && Array.isArray(p.blocks)) return p.blocks; } catch {}
    const lc = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']')); if (lc <= 0) break; s = s.slice(0, lc + 1);
  }
  return null;
}

export function dbMsgToDisplay(m) {
  if (m.role === 'user') return { role: 'user', text: m.content };
  try {
    const p = JSON.parse(m.content);
    let blocks = p.blocks || [];
    // Heal a stored message whose single text block is actually an unparsed envelope.
    if (blocks.length === 1 && blocks[0]?.type === 'text') {
      const rec = recoverDaemonEnvelope(blocks[0].md);
      if (rec) blocks = rec;
    }
    return { role: 'daemon', blocks };
  } catch {
    return { role: 'daemon', blocks: [{ type: 'text', md: m.content }] };
  }
}

