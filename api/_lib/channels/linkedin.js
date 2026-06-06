// LinkedIn channel — POST-ONLY + engagement via the official API. P2.
// DELIBERATELY no cold connection requests / DMs: LinkedIn has no API for it and
// automating it gets accounts banned. Cold outreach on LinkedIn is out of scope
// by product decision (see docs/specs/WorkDaemon_Growth_Agent_Spec.md).

export const id = 'linkedin';
export const label = 'LinkedIn (post-only)';
export const capabilities = { send: false, dm: false, post: true };

export function configured() {
  return Boolean(process.env.LINKEDIN_CLIENT_ID); // live posting lands in P2
}

export async function send() {
  const e = new Error('LinkedIn supports posting only (no cold DMs by design). Live posting lands in P2.');
  e.code = 'NOT_IMPLEMENTED';
  throw e;
}
