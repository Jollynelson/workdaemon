// Client for the WorkDaemon FINAL-spec backend (FastAPI).
//
// Base URL is configurable: VITE_BRAIN_API_URL (e.g. the deployed Modal/Fly URL)
// or same-origin '/api' in dev. Auth reuses the app's existing Bearer token.
// The UI never references DeepSeek/Hermes — these are WorkDaemon endpoints.

const BASE = (import.meta.env.VITE_BRAIN_API_URL || '').replace(/\/$/, '');

function url(path) {
  return `${BASE}${path}`;
}

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(url(path), {
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
  chat({ companyId, staffId, message, history = [], token }) {
    return call('/api/chat', {
      method: 'POST', token,
      body: { company_id: companyId, staff_id: staffId, message, history },
    });
  },

  // Activity feed (role-gated server-side).
  feed({ companyId, viewerLevel = 'junior', limit = 50, token }) {
    return call(`/api/feed/${companyId}?viewer_level=${viewerLevel}&limit=${limit}`, { token });
  },

  // Pending pushes for a staff member (Brain → agent inbox).
  pushes({ companyId, staffId, token }) {
    return call(`/api/pushes/${companyId}/${staffId}`, { token });
  },

  // Cross-agent tasks.
  tasks({ companyId, staffId, token }) {
    return call(`/api/tasks/${companyId}/${staffId}`, { token });
  },
  createTask({ companyId, fromStaffId, toStaffId, title, brief = '', priority = 'normal', token }) {
    return call('/api/tasks', {
      method: 'POST', token,
      body: { company_id: companyId, from_staff_id: fromStaffId, to_staff_id: toStaffId,
              title, brief, priority },
    });
  },

  // Real-time websocket (pushes + feed). Caller handles messages.
  connectWebsocket({ companyId, staffId }) {
    const wsBase = BASE.replace(/^http/, 'ws');
    return new WebSocket(`${wsBase}/ws/${companyId}/${staffId}`);
  },
};
