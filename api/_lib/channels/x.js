// X (Twitter) channel — post + DM via the official paid API. P2.
// Uses the workspace's connected X token (oauth.getAccessToken(db, ws, 'x')).
// Stubbed with the standard interface so the engine + UI treat it uniformly;
// drafting/queueing already works — only the live send lands in P2.

export const id = 'x';
export const label = 'X (Twitter)';
export const capabilities = { send: true, dm: true, post: true };

export function configured() {
  return Boolean(process.env.X_CLIENT_ID); // live send wiring lands in P2
}

export async function send() {
  const e = new Error('X channel send is not wired yet (P2). Draft + queue works; approval will send once X API is connected.');
  e.code = 'NOT_IMPLEMENTED';
  throw e;
}
