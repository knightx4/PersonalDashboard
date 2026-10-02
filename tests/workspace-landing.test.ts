import { afterEach, describe, expect, it, vi } from 'vitest';
import { rememberedPath } from '@/components/shell/workspace-switcher';
import { moduleById } from '@/lib/modules';

/**
 * Where switching to a workspace lands (plan #773): where you last were in
 * it, except Learn, which always opens on its home, Home (plan #1313). It
 * opened on Learn now from plan #805 until then.
 */

function rememberLastPaths(paths: Record<string, string>) {
  vi.stubGlobal('window', {
    localStorage: { getItem: () => JSON.stringify(paths), setItem: () => {} },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('rememberedPath', () => {
  it('lands where you last were in a workspace', () => {
    rememberLastPaths({ jobs: '/jobs/pipeline' });
    expect(rememberedPath('jobs', '/jobs')).toBe('/jobs/pipeline');
  });

  it('lands Learn on Now whatever page you left it on', () => {
    rememberLastPaths({ learn: '/learn/lists' });
    const home = moduleById('learn')?.home;
    expect(home).toBe('/learn/now');
    expect(rememberedPath('learn', home!)).toBe('/learn/now');
  });

  it('lands on the home when nothing is remembered', () => {
    rememberLastPaths({});
    expect(rememberedPath('vault', '/vault')).toBe('/vault');
  });
});
