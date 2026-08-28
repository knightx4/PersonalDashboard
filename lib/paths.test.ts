import { describe, expect, it } from 'vitest';
import { safeAppPath } from '@/lib/paths';

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
