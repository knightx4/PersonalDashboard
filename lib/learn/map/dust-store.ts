import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';

/**
 * Matching each vault note with the idea it is most like (plan #1997.6), as a
 * stage of the daily run after the places, so Idea Space can draw the notes
 * as dust beside their ideas without comparing vectors on every visit.
 *
 * The comparing is done in the database (learn.refresh_vault_dust, migration
 * learn 0114), a batch of notes per call so no call runs long. A note whose
 * embedding or idea is removed loses its row by cascade, so nothing here
 * deletes.
 */

const NOTES_PER_CALL = 200;
/** A guard against a call that keeps answering with the same note. */
const MAX_CALLS = 200;

export type RefreshDustResult = { calls: number };

export async function refreshVaultDust(
  learn: LearnSupabaseClient,
  userId: string,
): Promise<RefreshDustResult> {
  let after: string | null = null;
  let calls = 0;
  while (calls < MAX_CALLS) {
    const rpc = learn.rpc as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data: string | null; error: { message: string } | null }>;
    const { data, error } = await rpc('refresh_vault_dust', {
      p_user_id: userId,
      p_after: after,
      p_limit: NOTES_PER_CALL,
    });
    calls += 1;
    if (error) throw new Error(`Matching notes to ideas failed: ${error.message}`);
    if (!data || data === after) break;
    after = data;
  }
  return { calls };
}
