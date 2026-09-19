/**
 * Ticking Dev on the account page, as somebody who is not the owner.
 *
 * The checkbox is not drawn for them, which is the half you can see. This is
 * the other half: a form is a thing anybody can post, and the action has to be
 * right when the page that sent it was not the page we wrote. It reads the
 * allowed list and asks the form about each of those, rather than reading the
 * form and trusting what is in it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  owner: false,
  saved: [] as Array<Record<string, unknown>>,
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

vi.mock('@/lib/auth/server', () => ({
  requireUser: async () => ({ id: 'user-1', email: 'someone@example.com' }),
}));

vi.mock('@/lib/dev/owner', () => ({ isOwner: async () => state.owner }));

vi.mock('@/lib/core/auth/server', () => ({
  createCoreClient: async () => ({
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        state.saved.push(patch);
        return { eq: async () => ({ error: null }) };
      },
    }),
  }),
}));

const { updateEnabledModules } = await import('@/app/account/actions');

/** The form the page posts: one `on` per ticked box, nothing for the rest. */
function form(...ticked: string[]): FormData {
  const data = new FormData();
  for (const id of ticked) data.set(`module:${id}`, 'on');
  return data;
}

function savedModules(): string[] {
  const last = state.saved.at(-1);
  return (last?.enabled_modules as string[]) ?? [];
}

beforeEach(() => {
  state.saved = [];
});

describe('updateEnabledModules', () => {
  it('leaves dev off for another account, however the form arrives', async () => {
    state.owner = false;
    const result = await updateEnabledModules({}, form('shopping', 'todo', 'dev'));

    expect(result.error).toBeUndefined();
    expect(savedModules()).toEqual(['shopping', 'todo']);
  });

  it('saves dev for the owner, who is the one it belongs to', async () => {
    state.owner = true;
    await updateEnabledModules({}, form('shopping', 'dev'));

    expect(savedModules()).toEqual(['shopping', 'dev']);
  });

  it('refuses a form that would leave nothing on, dev alone included', async () => {
    state.owner = false;
    const result = await updateEnabledModules({}, form('dev'));

    // The only box ticked was one this account may not have, so the save would
    // have emptied the switcher. Saying so beats a constraint violation.
    expect(result.error).toContain('at least one workspace');
    expect(state.saved).toEqual([]);
  });
});
