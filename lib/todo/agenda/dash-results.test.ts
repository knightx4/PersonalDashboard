import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The count behind Todo's line about Dash's results (plan #1268): what the
 * goals read says, nothing when Goals is off, and nothing when the read fails.
 */

const state = { modules: ['todo', 'goals'], count: 2 as number | Error };
const loadUnreadDashResults = vi.fn(async () => {
  if (state.count instanceof Error) throw state.count;
  return state.count;
});

vi.mock('@/lib/core/account/settings', () => ({
  loadAccountSettings: async () => ({ timezone: 'UTC', enabledModules: state.modules }),
  moduleEnabled: (settings: { enabledModules: string[] }, module: string) =>
    settings.enabledModules.includes(module),
}));
vi.mock('@/lib/goals/steps-store', () => ({ loadUnreadDashResults }));
vi.mock('@/lib/todo/agenda/clients', () => ({ sessionClients: {} }));

const { loadDashResultsCount } = await import('./dash-results');

const clients = { core: async () => ({}), goals: async () => ({}) } as never;
const now = new Date('2026-09-29T12:00:00Z');

describe('loadDashResultsCount', () => {
  beforeEach(() => {
    state.modules = ['todo', 'goals'];
    state.count = 2;
    loadUnreadDashResults.mockClear();
  });

  it("is the goals read's count, for the account's today", async () => {
    expect(await loadDashResultsCount('u', now, clients)).toBe(2);
    expect(loadUnreadDashResults).toHaveBeenCalledWith({}, { userId: 'u', today: '2026-09-29' });
  });

  it('is zero when the Goals workspace is off, without reading it', async () => {
    state.modules = ['todo'];
    expect(await loadDashResultsCount('u', now, clients)).toBe(0);
    expect(loadUnreadDashResults).not.toHaveBeenCalled();
  });

  it('is zero when the read fails', async () => {
    state.count = new Error('down');
    expect(await loadDashResultsCount('u', now, clients)).toBe(0);
  });
});
