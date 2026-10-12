import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  laterStamp,
  NO_SNOOZES,
  parseSnoozeRef,
  snoozeStateFrom,
  type InboxSnooze,
  type SnoozeState,
} from './inbox-snoozes';

/** A client on any schema; the reads below name the schema themselves. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any>;

/**
 * Each row's change stamp now: its updated_at, or the time of its newest
 * thread turn when that is later, since a comment does not touch the row.
 * A row that no longer exists is left out.
 */
export async function currentRowStamps(
  client: Client,
  userId: string,
  refs: readonly string[],
): Promise<Map<string, string>> {
  const stamps = new Map<string, string>();
  const byTable = new Map<string, string[]>();
  for (const ref of refs) {
    const parsed = parseSnoozeRef(ref);
    if (!parsed) continue;
    byTable.set(parsed.table, [...(byTable.get(parsed.table) ?? []), parsed.id]);
  }
  await Promise.all(
    [...byTable].map(async ([table, ids]) => {
      const [schema, name] = table.split('.');
      const { data } = await client.schema(schema).from(name).select('id, updated_at').in('id', ids);
      for (const row of (data ?? []) as { id: string; updated_at: string }[]) {
        stamps.set(`${table}:${row.id}`, row.updated_at);
      }
    }),
  );
  if (stamps.size === 0) return stamps;
  const { data: turns } = await client
    .schema('core')
    .from('thread_turns')
    .select('ref, created_at')
    .eq('user_id', userId)
    .in('ref', [...stamps.keys()]);
  for (const turn of (turns ?? []) as { ref: string; created_at: string }[]) {
    stamps.set(turn.ref, laterStamp(stamps.get(turn.ref), turn.created_at));
  }
  return stamps;
}

/**
 * Every snooze the person has, in one query, sorted against the rows as they
 * are now. One read when there are none, which is most visits. Never throws:
 * an inbox that cannot read its snoozes shows everything.
 */
export async function loadSnoozeState(
  client: Client,
  userId: string,
  now: Date = new Date(),
): Promise<SnoozeState> {
  try {
    const { data, error } = await client
      .schema('core')
      .from('inbox_snoozes')
      .select('ref, snoozed_until, row_updated_at')
      .eq('user_id', userId);
    if (error || !data || data.length === 0) return NO_SNOOZES;
    const snoozes = data as InboxSnooze[];
    const stamps = await currentRowStamps(
      client,
      userId,
      snoozes.map((s) => s.ref),
    );
    return snoozeStateFrom(snoozes, stamps, now);
  } catch (error) {
    console.error(`The inbox could not read its snoozes: ${(error as Error).message}`);
    return NO_SNOOZES;
  }
}
