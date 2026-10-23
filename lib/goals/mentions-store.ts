import 'server-only';

import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import type { MentionState, PassiveMention } from '@/lib/goals/passive-mentions';

/**
 * Reads and writes for goals.mentions (goals migration 0087; plan #2503.5).
 * The rules are in lib/goals/passive-mentions.ts.
 *
 * The home passes the signed-in client, so row level security scopes the
 * rows to the person. The morning run passes the service-role client with
 * `userId`, which every read and write then names.
 */

type MentionRow = { ref: string; mentioned_at: string | null; dismissed_at: string | null };

/** What is stored for each ref that has a row. */
export async function loadMentionStates(
  client: GoalsSupabaseClient,
  userId?: string,
): Promise<Map<string, MentionState>> {
  let query = client.from('mentions').select('ref, mentioned_at, dismissed_at');
  if (userId) query = query.eq('user_id', userId);
  const { data, error } = await query;
  if (error) throw new Error(`Could not read mentions: ${error.message}`);
  return new Map(
    ((data ?? []) as MentionRow[]).map((row) => [
      row.ref,
      { mentioned: row.mentioned_at !== null, dismissed: row.dismissed_at !== null },
    ]),
  );
}

/**
 * Marks these as mentioned by the morning note, so the next brief does not
 * list them again. A row already there keeps its dismissal.
 */
export async function markMentioned(
  client: GoalsSupabaseClient,
  userId: string,
  mentions: readonly PassiveMention[],
  now: number,
): Promise<void> {
  if (mentions.length === 0) return;
  const at = new Date(now).toISOString();
  const { error } = await client.from('mentions').upsert(
    mentions.map((m) => ({ user_id: userId, ref: m.ref, on_date: m.on, mentioned_at: at })),
    { onConflict: 'user_id,ref' },
  );
  if (error) throw new Error(`Could not record the mentions: ${error.message}`);
}

/** Dismiss on the home: the mention is not listed or briefed again. */
export async function dismissMention(
  client: GoalsSupabaseClient,
  userId: string,
  { ref, on }: { ref: string; on: string },
  now: number = Date.now(),
): Promise<void> {
  const { error } = await client.from('mentions').upsert(
    { user_id: userId, ref, on_date: on, dismissed_at: new Date(now).toISOString() },
    { onConflict: 'user_id,ref' },
  );
  if (error) throw new Error(`Could not dismiss the mention: ${error.message}`);
}

/** The toast's Undo on a dismissal: the mention is listed again. */
export async function undismissMention(
  client: GoalsSupabaseClient,
  userId: string,
  ref: string,
): Promise<void> {
  const { error } = await client
    .from('mentions')
    .update({ dismissed_at: null })
    .eq('user_id', userId)
    .eq('ref', ref);
  if (error) throw new Error(`Could not bring the mention back: ${error.message}`);
}
