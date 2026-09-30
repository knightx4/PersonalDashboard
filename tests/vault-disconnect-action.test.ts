/**
 * Disconnecting a vault takes its attachment copies with it (plan #1303).
 *
 * The attachment rows cascade from the connection in the database; the files
 * in the vault-attachments bucket do not, so the action clears the
 * connection's folder. Only a connection this user actually deleted is
 * cleared, and only that connection's folder.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeStorage } from './stubs/fake-storage';

const CONN = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const state = vi.hoisted(() => ({
  store: null as null | ReturnType<typeof import('./stubs/fake-storage').fakeStorage>,
  owned: [] as string[],
  filters: [] as Array<[string, string]>,
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/auth/server', () => ({ requireUser: async () => ({ id: 'user-1' }) }));
vi.mock('@/lib/vault/auth/server', () => ({
  createVaultClient: async () => ({
    from: () => ({
      delete: () => {
        const filters: Array<[string, string]> = [];
        const chain = {
          eq(column: string, value: string) {
            filters.push([column, value]);
            state.filters.push([column, value]);
            return chain;
          },
          async select() {
            const id = filters.find(([c]) => c === 'id')?.[1];
            const hit = id && state.owned.includes(id);
            if (hit) state.owned = state.owned.filter((x) => x !== id);
            return { data: hit ? [{ id }] : [], error: null };
          },
        };
        return chain;
      },
    }),
  }),
}));
vi.mock('@/inngest/jobs/supabase-admin', () => ({
  createServiceSupabase: () => state.store!.client,
}));

const { disconnectVault } = await import('@/app/vault/settings/actions');

function form(id: string): FormData {
  const data = new FormData();
  data.set('id', id);
  return data;
}

beforeEach(() => {
  state.owned = [CONN];
  state.filters = [];
  state.store = fakeStorage({
    'vault-attachments': [`user-1/${CONN}/aaa`, `user-1/${CONN}/bbb`, `user-1/${OTHER}/ccc`],
  });
});

describe('disconnectVault', () => {
  it("removes the connection's attachment files, scoped to the session's user", async () => {
    await disconnectVault(form(CONN));

    expect(state.filters).toContainEqual(['user_id', 'user-1']);
    expect(state.store!.left('vault-attachments')).toEqual([`user-1/${OTHER}/ccc`]);
  });

  it('removes no files when no connection of theirs was deleted', async () => {
    await disconnectVault(form(OTHER));

    expect(state.store!.left('vault-attachments')).toHaveLength(3);
  });
});
