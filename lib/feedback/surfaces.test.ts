import { describe, expect, it } from 'vitest';
import { checkClose, surfaceOf, surfacePath } from './surfaces';

describe('surfacePath / surfaceOf', () => {
  it('round-trips a surface id', () => {
    expect(surfaceOf(surfacePath('jobs-pipeline-dense'))).toBe('jobs-pipeline-dense');
  });

  it('reads the id back out of a stored path', () => {
    expect(surfaceOf('/preview?s=dev-ui')).toBe('dev-ui');
  });

  it('returns null for a note filed from the app itself', () => {
    expect(surfaceOf('/jobs/roles/42')).toBeNull();
    expect(surfaceOf('/shopping/orders')).toBeNull();
  });

  it('returns null when there is no page path at all', () => {
    expect(surfaceOf(null)).toBeNull();
    expect(surfaceOf(undefined)).toBeNull();
  });

  // A plain visit to the gallery is not a note about a surface. Matching it
  // loosely would file design notes against a surface nobody named.
  it('ignores the gallery index and anything not exactly the stored shape', () => {
    expect(surfaceOf('/preview')).toBeNull();
    expect(surfaceOf('/preview?s=')).toBeNull();
    expect(surfaceOf('/preview?s=dev-ui&w=390')).toBeNull();
    expect(surfaceOf('https://example.com/preview?s=dev-ui')).toBeNull();
    expect(surfaceOf('/dev/preview?s=dev-ui')).toBeNull();
  });
});

describe('checkClose', () => {
  const laws = [1, 9, 13, 14, 15] as const;
  const base = { note: 'made it a list', law: null as string | null, lawNumbers: laws };

  it('lets an ordinary note close with no law', () => {
    const r = checkClose({ ...base, pagePath: '/jobs/roles/42', command: 'done' });
    expect(r).toEqual({ ok: true, resolution: 'made it a list' });
  });

  it('refuses to close a surface note without a law', () => {
    const r = checkClose({ ...base, pagePath: '/preview?s=dev-ui', command: 'done' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('--law');
  });

  it('refuses a law number that does not exist', () => {
    const r = checkClose({ ...base, pagePath: '/preview?s=dev-ui', command: 'done', law: '99' });
    expect(r.ok).toBe(false);
  });

  it('records the law in the resolution', () => {
    const r = checkClose({ ...base, pagePath: '/preview?s=dev-ui', command: 'done', law: '13' });
    expect(r).toEqual({ ok: true, resolution: 'Law 13 — made it a list' });
  });

  // The absence of a law is not a law. Writing "Law none —" would read as one.
  it('accepts none and does not dress it up as a law', () => {
    const r = checkClose({ ...base, pagePath: '/preview?s=dev-ui', command: 'done', law: 'none' });
    expect(r).toEqual({ ok: true, resolution: 'made it a list' });
  });

  // Blocking is not a claim that the surface was put right, so it needs no law.
  it('does not demand a law to block or decline a surface note', () => {
    for (const command of ['block', 'decline'] as const) {
      expect(checkClose({ ...base, pagePath: '/preview?s=dev-ui', command }).ok).toBe(true);
    }
  });
});
