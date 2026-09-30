import { describe, expect, it } from 'vitest';
import { safeAppPath, signInRedirect } from '@/lib/paths';

describe('safeAppPath', () => {
  it('allows relative app paths', () => {
    expect(safeAppPath('/onboarding', '/shopping/settings')).toBe('/onboarding');
    expect(safeAppPath('/onboarding?step=done', '/shopping/settings')).toBe(
      '/onboarding?step=done',
    );
    expect(safeAppPath('/shopping/settings?inbox=connected', '/shopping/settings')).toBe(
      '/shopping/settings?inbox=connected',
    );
  });

  it('carries a path into the other workspace unchanged', () => {
    // Both halves share this helper, so it must not assume a prefix.
    expect(safeAppPath('/jobs/settings', '/shopping/settings')).toBe('/jobs/settings');
  });

  it('rejects absolute and protocol-relative URLs', () => {
    expect(safeAppPath('https://evil.example/x', '/shopping/settings')).toBe(
      '/shopping/settings',
    );
    expect(safeAppPath('//evil.example', '/shopping/settings')).toBe('/shopping/settings');
    expect(safeAppPath(null, '/shopping/dashboard')).toBe('/shopping/dashboard');
  });
});

describe('signInRedirect', () => {
  it('keeps the query of the page asked for', () => {
    const url = signInRedirect(
      new URL('https://dash.example/oauth/consent?authorization_id=abc-123'),
    );
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('next')).toBe('/oauth/consent?authorization_id=abc-123');
    // Only `next`: the page's own parameters do not leak onto the sign-in page.
    expect([...url.searchParams.keys()]).toEqual(['next']);
    expect(url.origin).toBe('https://dash.example');
  });

  it('passes a plain path through', () => {
    const url = signInRedirect(new URL('https://dash.example/todo'));
    expect(url.searchParams.get('next')).toBe('/todo');
  });

  it('round-trips through safeAppPath', () => {
    const url = signInRedirect(
      new URL('https://dash.example/oauth/consent?authorization_id=a&b=c'),
    );
    expect(safeAppPath(url.searchParams.get('next'), '/onboarding')).toBe(
      '/oauth/consent?authorization_id=a&b=c',
    );
  });
});
