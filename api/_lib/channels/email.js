// Email channel — outbound send via an ESP. Default provider: Resend
// (pluggable to SES/Postmark by swapping this file). Used by the agent engine.
//
// COMPLIANCE (enforced by the engine, documented here):
//  - Send only from a dedicated sending domain (EMAIL_FROM), never the apex.
//  - The engine checks suppression_list before calling send().
//  - Every message body must carry a one-click unsubscribe + physical address
//    (CAN-SPAM / GDPR). The engine appends the footer.
//
// Env: RESEND_API_KEY, EMAIL_FROM (e.g. "WorkDaemon <hello@mail.getworkdaemon.com>")

export const id = 'email';
export const label = 'Email';
export const capabilities = { send: true, dm: false, post: false };

export function configured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

// to: recipient email. subject/body required. meta.replyTo optional.
export async function send({ to, subject, body, meta = {} }) {
  if (!configured()) {
    const e = new Error('Email channel not configured (set RESEND_API_KEY + EMAIL_FROM)');
    e.code = 'NOT_CONFIGURED';
    throw e;
  }
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 12000);
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [to],
        subject: subject || '(no subject)',
        text: body,
        ...(meta.replyTo ? { reply_to: meta.replyTo } : {}),
        ...(meta.headers ? { headers: meta.headers } : {}),
      }),
      signal: ac.signal,
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const e = new Error(json?.message || `ESP ${resp.status}`);
      e.code = 'SEND_FAILED';
      throw e;
    }
    return { providerId: json.id || null, status: 'sent' };
  } finally {
    clearTimeout(t);
  }
}
