import { describe, expect, it } from 'vitest';
import { safeAppPath } from '@/lib/paths';

describe('safeAppPath', () => {
  it('allows relative app paths', () => {
    expect(safeAppPath('/onboarding')).toBe('/onboarding');
    expect(safeAppPath('/onboarding?step=done')).toBe('/onboarding?step=done');
    expect(safeAppPath('/settings?inbox=connected')).toBe('/settings?inbox=connected');
  });

  it('rejects absolute and protocol-relative URLs', () => {
    expect(safeAppPath('https://evil.example/x', '/settings')).toBe('/settings');
    expect(safeAppPath('//evil.example', '/settings')).toBe('/settings');
    expect(safeAppPath(null, '/dashboard')).toBe('/dashboard');
  });
});
