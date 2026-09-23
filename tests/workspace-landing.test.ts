import { afterEach, describe, expect, it, vi } from 'vitest';
import { rememberedPath } from '@/components/shell/workspace-switcher';

/**
 * Where switching to a workspace lands (plan #773): where you last were in
 * it, except Learn, which always opens on its home, Learn now (plan #805).
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
    expect(rememberedPath('jobs', '/jobs/today')).toBe('/jobs/pipeline');
  });

  it('lands Learn on its home whatever page you left it on', () => {
    rememberLastPaths({ learn: '/learn/lists' });
    expect(rememberedPath('learn', '/learn/now')).toBe('/learn/now');
  });

  it('lands on the home when nothing is remembered', () => {
    rememberLastPaths({});
    expect(rememberedPath('vault', '/vault')).toBe('/vault');
  });
});
