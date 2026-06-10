import { describe, it, expect } from 'vitest';
import { extractUrls } from '../research.js';

describe('extractUrls', () => {
  it('detects bare domains (the "no website betatenant.com" case)', () => {
    expect(extractUrls('no website betatenant.com')).toEqual(['https://betatenant.com']);
  });
  it('detects full URLs and strips trailing punctuation', () => {
    expect(extractUrls('see https://acme.io/pricing, it changed')).toEqual(['https://acme.io/pricing']);
  });
  it('handles a domain at the end of a sentence', () => {
    expect(extractUrls('check out stripe.com.')).toEqual(['https://stripe.com']);
  });
  it('does NOT treat email addresses as domains', () => {
    expect(extractUrls('mail me at nelson@gmail.com please')).toEqual([]);
  });
  it('dedupes a bare domain already covered by a full URL', () => {
    expect(extractUrls('https://acme.io and acme.io again')).toEqual(['https://acme.io']);
  });
  it('caps at max and handles empty input', () => {
    expect(extractUrls('a.com b.com c.com d.com', 3)).toHaveLength(3);
    expect(extractUrls('')).toEqual([]);
    expect(extractUrls(null)).toEqual([]);
  });
  it('ignores plain text with no domains', () => {
    expect(extractUrls('what is our revenue this quarter')).toEqual([]);
  });
});
