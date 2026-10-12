import 'server-only';
import type { InboxSnooze } from './inbox-snoozes';

/**
 * The reads and writes behind inbox snoozes (plan #1844), on whichever client
 * the caller holds: the person's own session, so core.inbox_snoozes' policy
 * keeps each snooze to its owner. Shared by every inbox that snoozes.
 */

type Result = PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** The part of a Supabase client these calls use: any client that can reach another schema. */
type AnyClient = {
  schema: (name: string) => {
    from: (table: string) => {
      select: (columns: string) => {
        in: (column: string, values: string[]) => Result;
      } & Result;
      upsert: (row: Record<string, unknown>, options: { onConflict: string }) => Result;
      delete: () => { eq: (column: string, value: string) => { eq: (column: string, value: string) => Result } };
    };
  };
};

const client = (c: unknown) => c as AnyClient;

/** Every snooze the person has, in one read. */
export async function loadInboxSnoozes(c: unknown): Promise<InboxSnooze[]> {
  const { data, error } = await client(c)
    .schema('core')
    .from('inbox_snoozes')
    .select('ref, snoozed_until, row_updated_at');
  if (error) throw new Error(`Could not read the snoozes: ${error.message}`);
  return (data as InboxSnooze[] | null) ?? [];
}

/**
 * Each ref's change stamp now: the later of the row's updated_at and its
 * newest turn in core.thread_turns, since a comment does not touch the row. A
 * ref whose row is gone has no stamp.
 */
export async function loadRowStamps(c: unknown, refs: readonly string[]): Promise<Map<string, string>> {
  const stamps = new Map<string, string>();
  if (refs.length === 0) return stamps;
  const later = (ref: string, at: string) => {
    const current = stamps.get(ref);
    if (!current || new Date(at).getTime() > new Date(current).getTime()) stamps.set(ref, at);
  };

  const byTable = new Map<string, string[]>();
  for (const ref of refs) {
    const [table, id] = ref.split(':');
    byTable.set(table, [...(byTable.get(table) ?? []), id]);
  }
  await Promise.all([
    ...[...byTable].map(async ([table, ids]) => {
      const [schema, name] = table.split('.');
      const { data, error } = await client(c).schema(schema).from(name).select('id, updated_at').in('id', ids);
      if (error) throw new Error(`Could not read ${table}: ${error.message}`);
      for (const row of (data as { id: string; updated_at: string }[] | null) ?? []) {
        later(`${table}:${row.id}`, row.updated_at);
      }
    }),
    (async () => {
      const { data, error } = await client(c)
        .schema('core')
        .from('thread_turns')
        .select('ref, created_at')
        .in('ref', [...refs]);
      if (error) throw new Error(`Could not read the comments: ${error.message}`);
      for (const turn of (data as { ref: string; created_at: string }[] | null) ?? []) {
        if (stamps.has(turn.ref)) later(turn.ref, turn.created_at);
      }
    })(),
  ]);
  return stamps;
}

/** Snooze a row until a time, recording its change stamp so a change lifts the snooze. */
export async function snoozeRow(
  c: unknown,
  input: { userId: string; ref: string; until: Date },
): Promise<{ error?: string }> {
  const stamps = await loadRowStamps(c, [input.ref]).catch(() => null);
  const stamp = stamps?.get(input.ref);
  if (!stamp) return { error: 'That row is no longer there.' };
  const { error } = await client(c)
    .schema('core')
    .from('inbox_snoozes')
    .upsert(
      {
        user_id: input.userId,
        ref: input.ref,
        snoozed_until: input.until.toISOString(),
        row_updated_at: stamp,
      },
      { onConflict: 'user_id,ref' },
    );
  return error ? { error: 'It could not be snoozed. Try again.' } : {};
}

/** Take a snooze off a row, so it is back at once. */
export async function unsnoozeRow(c: unknown, input: { userId: string; ref: string }): Promise<{ error?: string }> {
  const { error } = await client(c)
    .schema('core')
    .from('inbox_snoozes')
    .delete()
    .eq('user_id', input.userId)
    .eq('ref', input.ref);
  return error ? { error: 'It could not be brought back.' } : {};
}
