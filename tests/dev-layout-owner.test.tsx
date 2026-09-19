/**
 * The door to the Dev workspace.
 *
 * The layout is the whole of the wall for what gets drawn: refuse here and the
 * page inside is never rendered, so nothing from the plan, the bug queue or
 * the raises reaches the response at all. That is the claim worth a test --
 * not that a message appears, but that the workspace does not.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const state = vi.hoisted(() => ({ owner: false, loaded: [] as string[] }));

vi.mock('@/lib/auth/server', () => ({
  getUser: async () => ({ id: 'user-1', email: 'someone@example.com' }),
  createClient: async () => ({}),
}));

vi.mock('@/lib/dev/owner', () => ({ isOwner: async () => state.owner }));

vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('redirected');
  },
  usePathname: () => '/dev/raised',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

// Two of the loaders record that they ran. A non-owner must not make either
// fire: a layout that fetched the owner's plan and then declined to draw it
// has already put it in somebody else's response.
vi.mock('@/lib/plan/load', () => ({
  loadPlan: async () => {
    state.loaded.push('plan');
    return { items: [], dependencies: [] };
  },
}));

vi.mock('@/lib/raised/notifications', () => ({
  loadRaisedNotifications: async () => {
    state.loaded.push('raised');
    return [];
  },
}));

// The rest only have to exist, so the owner's half of the test gets a shell.
vi.mock('@/lib/core/account/settings', () => ({
  loadAccountSettings: async () => ({
    displayName: 'Sam',
    timezone: 'UTC',
    displayCurrency: 'GBP',
    enabledModules: ['dev'],
    theme: { kind: 'system' },
  }),
}));
vi.mock('@/lib/modules/counts', () => ({ loadModuleCounts: async () => ({}) }));
vi.mock('@/lib/shell/activity', () => ({ loadActivity: async () => [] }));
vi.mock('@/lib/shell/main-check', () => ({ loadMainCheck: async () => null }));

const { default: DevLayout } = await import('@/app/dev/layout');

describe('the dev layout', () => {
  it('turns another account away and draws none of the workspace', async () => {
    state.owner = false;
    state.loaded = [];

    const html = renderToStaticMarkup(
      await DevLayout({ children: <p>Bugs and requests, the plan, the raises</p> }),
    );

    expect(html).toContain('You do not have permission');
    expect(html).toContain('Dev workspace');
    // No page, no sidebar, no counts -- and nothing was read to build them.
    expect(html).not.toContain('Bugs and requests');
    expect(html).not.toContain('Changelog');
    expect(state.loaded).toEqual([]);
  });

  it('is unchanged for the owner', async () => {
    state.owner = true;
    state.loaded = [];

    const html = renderToStaticMarkup(
      await DevLayout({ children: <p>Bugs and requests, the plan, the raises</p> }),
    );

    expect(html).not.toContain('You do not have permission');
    expect(html).toContain('Bugs and requests');
    expect(html).toContain('Changelog');
    expect(state.loaded.sort()).toEqual(['plan', 'raised']);
  });
});
