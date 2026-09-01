import { describe, expect, it } from 'vitest';
import { parseCompanyLookupPayload } from './ai-company-payload';

describe('parseCompanyLookupPayload', () => {
  it('accepts a website and a summary', () => {
    const result = parseCompanyLookupPayload({
      website: 'https://ramp.com',
      summary: 'Ramp is a corporate card and spend management platform.',
      sources: [{ title: 'Ramp', url: 'https://ramp.com' }],
      no_data: false,
    });
    expect(result).toEqual({
      ok: true,
      website: 'https://ramp.com',
      summary: 'Ramp is a corporate card and spend management platform.',
      sources: [{ title: 'Ramp', url: 'https://ramp.com' }],
    });
  });

  it('reports no_data rather than a guess', () => {
    const result = parseCompanyLookupPayload({ no_data: true, website: null, summary: null });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-URL website', () => {
    const result = parseCompanyLookupPayload({
      website: 'not a url',
      summary: 'Something',
      no_data: false,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a payload with neither a website nor a summary', () => {
    const result = parseCompanyLookupPayload({ website: null, summary: null, no_data: false });
    expect(result.ok).toBe(false);
  });

  it('rejects a malformed payload', () => {
    const result = parseCompanyLookupPayload({ sources: 'not an array' });
    expect(result.ok).toBe(false);
  });
});
