/**
 * What I want from posts (plan #2227.2): Save trims the text and keeps one
 * row per person, an emptied box deletes the row, and text past the limit is
 * refused before anything is written.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const USER_ID = 'owner-0000-0000-0000-000000000000';

const state = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; op: string; args: unknown[] }>,
  error: null as { message: string } | null,
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/auth/server', () => ({
  createClient: async () => ({
    from(table: string) {
      const record = (op: string) => (...args: unknown[]) => {
        state.calls.push({ table, op, args });
        return builder;
      };
      const builder: Record<string, unknown> = {
        upsert: record('upsert'),
        delete: record('delete'),
        eq: record('eq'),
        then: (resolve: (value: unknown) => unknown) => resolve({ data: null, error: state.error }),
      };
      return builder;
    },
  }),
}));
vi.mock('@/lib/dev/owner', () => ({ requireOwner: async () => ({ id: USER_ID }) }));

const { savePostWants } = await import('@/app/dev/posts/actions');

function save(wants: string) {
  const form = new FormData();
  form.set('wants', wants);
  return savePostWants({}, form);
}

beforeEach(() => {
  state.calls = [];
  state.error = null;
});

describe('savePostWants', () => {
  it('saves the trimmed text as the one row for the person', async () => {
    expect(await save('  No hashtags.\n')).toEqual({ message: 'Saved.' });
    expect(state.calls).toEqual([
      {
        table: 'post_preferences',
        op: 'upsert',
        args: [{ user_id: USER_ID, wants: 'No hashtags.' }, { onConflict: 'user_id' }],
      },
    ]);
  });

  it('deletes the row when the box is emptied', async () => {
    expect(await save('   ')).toEqual({ message: 'Cleared.' });
    expect(state.calls.map((call) => call.op)).toEqual(['delete', 'eq']);
    expect(state.calls[1]!.args).toEqual(['user_id', USER_ID]);
  });

  it('refuses text past 2,000 characters and writes nothing', async () => {
    expect(await save('a'.repeat(2001))).toEqual({ error: 'Keep it under 2,000 characters.' });
    expect(state.calls).toEqual([]);
  });

  it('keeps exactly 2,000 characters', async () => {
    expect(await save('a'.repeat(2000))).toEqual({ message: 'Saved.' });
  });

  it('passes a failed write back as the error', async () => {
    state.error = { message: 'boom' };
    expect(await save('Shorter.')).toEqual({ error: 'boom' });
  });
});
