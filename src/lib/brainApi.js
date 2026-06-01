// Client for the WorkDaemon FINAL-spec backend (FastAPI).
//
// Base URL: VITE_BRAIN_API_URL (deployed backend) or same-origin in dev.
// Identity is derived SERVER-SIDE from the Supabase auth token — the client only
// sends the token, never its own company_id/staff_id (closes cross-tenant access).
// The UI never references DeepSeek/Hermes — these are WorkDaemon endpoints.

const BASE = (import.meta.env.VITE_BRAIN_API_URL || '').replace(/\/$/, '');

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.error || `Request failed (${res.status})`);
  return data;
}

export const brainApi = {
  // Daemon Chat — one turn through the Brain-visibility pipeline.
  chat({ message, history = [], token }) {
    return call('/api/chat', { method: 'POST', token, body: { message, history } });
  },

  // Prewarm the company's GPU model on login (fire-and-forget — never throws into
  // the UI). Kicks the scale-to-zero serving GPU so it's warming while the user
  // reads their catch-up briefing; the first real turn can then use the company model.
  warm({ token }) {
    return call('/api/warm', { method: 'POST', token }).catch(() => {});
  },

  // Activity feed (role-gated server-side by the caller's access level).
  feed({ limit = 50, token }) {
    return call(`/api/feed?limit=${limit}`, { token });
  },

  // Pending pushes for the caller (Brain → agent inbox).
  pushes({ token }) {
    return call('/api/pushes', { token });
  },

  // Daemon character — name, what it calls you, and persona ("soul").
  getDaemon({ token }) {
    return call('/api/daemon', { token });
  },
  updateDaemon({ token, daemonName, preferredName, persona }) {
    return call('/api/daemon', {
      method: 'PATCH', token,
      body: {
        ...(daemonName != null ? { daemon_name: daemonName } : {}),
        ...(preferredName != null ? { preferred_name: preferredName } : {}),
        ...(persona != null ? { persona } : {}),
      },
    });
  },

  // Cross-agent tasks assigned to the caller.
  tasks({ token }) {
    return call('/api/tasks', { token });
  },
  createTask({ toStaffId, title, brief = '', priority = 'normal', token }) {
    return call('/api/tasks', {
      method: 'POST', token,
      body: { to_staff_id: toStaffId, title, brief, priority },
    });
  },

  // Real-time websocket (pushes + feed). companyId/staffId come from /api/me-style
  // resolution on the caller; pass them in once known. Caller handles messages.
  connectWebsocket({ companyId, staffId }) {
    const wsBase = BASE.replace(/^http/, 'ws');
    return new WebSocket(`${wsBase}/ws/${companyId}/${staffId}`);
  },
};
