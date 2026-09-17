/**
 * Every write here must carry a filter of its own.
 *
 * Supabase loads `safeupdate` into the API role, so an UPDATE that arrives
 * with no WHERE clause is refused outright -- "UPDATE requires a WHERE
 * clause" -- however well the row level security policy would have scoped it.
 * Replacing your address relied on the policy alone and broke the moment
 * anybody pressed the button. These assertions are about the shape of the
 * query rather than its result, because the shape is what was wrong.
 */
import { describe, expect, it } from 'vitest';
import { LOCAL_PART } from '@/lib/news/address';
import type { NewsSupabaseClient } from '@/lib/news/db/schema-name';
import { replaceLocalPart } from './address';

const ME = '11111111-1111-4111-8111-111111111111';

/** Records the chain rather than running it: which table, which filters. */
function spyClient() {
  const calls: { table?: string; update?: Record<string, unknown>; eq: [string, unknown][] } = {
    eq: [],
  };

  const chain = {
    update(values: Record<string, unknown>) {
      calls.update = values;
      return chain;
    },
    eq(column: string, value: unknown) {
      calls.eq.push([column, value]);
      return chain;
    },
    select() {
      return chain;
    },
    async single() {
      return { data: { local_part: String(calls.update?.local_part) }, error: null };
    },
  };

  const client = {
    from(table: string) {
      calls.table = table;
      return chain;
    },
  } as unknown as NewsSupabaseClient;

  return { client, calls };
}

describe('replaceLocalPart', () => {
  it('filters on the account, so safeupdate does not reject the write', async () => {
    const { client, calls } = spyClient();
    await replaceLocalPart(client, ME);

    expect(calls.table).toBe('addresses');
    expect(calls.eq).toContainEqual(['user_id', ME]);
  });

  it('never sends an update with no filter at all', async () => {
    const { client, calls } = spyClient();
    await replaceLocalPart(client, ME);

    expect(calls.eq.length).toBeGreaterThan(0);
  });

  it('writes a fresh local part the column will accept, and returns it', async () => {
    const { client, calls } = spyClient();
    const returned = await replaceLocalPart(client, ME);

    expect(returned).toMatch(LOCAL_PART);
    expect(calls.update?.local_part).toBe(returned);
  });

  it('does not write the account id -- the row already belongs to you', async () => {
    const { client, calls } = spyClient();
    await replaceLocalPart(client, ME);

    expect(Object.keys(calls.update ?? {})).toEqual(['local_part']);
  });
});
