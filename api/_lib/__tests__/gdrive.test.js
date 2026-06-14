import { describe, it, expect } from 'vitest';
import { gmailPlainText, mapGmailMessage, mapGoogleEvent } from '../connectors/gdrive.js';

// base64url encode, the way Gmail returns body data.
const b64 = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('gmailPlainText', () => {
  it('decodes a text/plain body', () => {
    expect(gmailPlainText({ mimeType: 'text/plain', body: { data: b64('Hello body') } })).toBe('Hello body');
  });
  it('prefers text/plain over html in a multipart message', () => {
    const payload = { mimeType: 'multipart/alternative', parts: [
      { mimeType: 'text/html', body: { data: b64('<p>Hi <b>there</b></p>') } },
      { mimeType: 'text/plain', body: { data: b64('plain wins') } },
    ] };
    expect(gmailPlainText(payload)).toBe('plain wins');
  });
  it('falls back to stripped HTML when there is no plain part', () => {
    expect(gmailPlainText({ mimeType: 'text/html', body: { data: b64('<p>Only HTML</p>') } })).toBe('Only HTML');
  });
  it('is safe on empty/garbage input', () => {
    expect(gmailPlainText(null)).toBe('');
    expect(gmailPlainText({})).toBe('');
  });
});

describe('mapGmailMessage', () => {
  it('builds an email doc with the real body + structured headers', () => {
    const msg = { id: 'm1', threadId: 't1', snippet: 'snip', payload: {
      headers: [{ name: 'Subject', value: 'Q3 plan' }, { name: 'From', value: 'a@co' }, { name: 'To', value: 'b@co' }, { name: 'Date', value: 'Mon' }],
      mimeType: 'text/plain', body: { data: b64('the full email body') },
    } };
    const doc = mapGmailMessage(msg);
    expect(doc).toMatchObject({ external_id: 'gmail-m1', doc_type: 'email', title: 'Q3 plan', author: 'a@co' });
    expect(doc.content).toContain('the full email body');
    expect(doc.metadata).toMatchObject({ from: 'a@co', to: 'b@co', date: 'Mon', thread_id: 't1' });
  });
});

describe('mapGoogleEvent', () => {
  const ev = {
    id: 'e1', summary: 'Onboarding', description: 'Welcome', location: 'Room 1', htmlLink: 'http://x',
    start: { dateTime: '2020-01-01T10:00:00Z' }, end: { dateTime: '2020-01-01T11:00:00Z' },
    organizer: { email: 'hr@co' }, status: 'confirmed',
    attendees: [
      { email: 'a@co', displayName: 'Angela', responseStatus: 'needsAction' },
      { email: 'hr@co', organizer: true, responseStatus: 'accepted' },
    ],
  };

  it('captures structured attendees, organizer, location and past/upcoming', () => {
    const doc = mapGoogleEvent(ev, Date.parse('2025-01-01'));
    expect(doc).toMatchObject({ external_id: 'gcal-e1', doc_type: 'event', title: 'Onboarding', author: 'hr@co' });
    expect(doc.metadata).toMatchObject({ when: 'past', attendee_count: 2, location: 'Room 1', organizer: 'hr@co' });
    expect(doc.metadata.attendees[0]).toMatchObject({ email: 'a@co', name: 'Angela', response: 'needsAction' });
    expect(doc.content).toContain('Angela (needsAction)');
    expect(doc.content).toContain('Where: Room 1');
  });

  it('flags a future event as upcoming', () => {
    const future = { ...ev, end: { dateTime: '2999-01-01T11:00:00Z' } };
    expect(mapGoogleEvent(future, Date.parse('2025-01-01')).metadata.when).toBe('upcoming');
  });
});
