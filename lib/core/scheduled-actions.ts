import type { AskSchema, SchemaClient } from '@/lib/ask/db';
import {
  readSubjectOrNull,
  recordDashAction,
  type DashActionDeps,
  type DashActionEntry,
} from '@/lib/core/dash-actions';

/**
 * Recording what a scheduled run changes (plan #1570, feature #1456).
 *
 * A cron route has no signed-in person, so the request clients Ask Dash and
 * capture record through do not exist there. The run already holds a service
 * client, and that is what these build the record's deps from: core.dash_actions
 * through its `core` schema, and the row the run touched through whichever
 * schema the ref names. The service role sees every account, so the record
 * names the row's own user and the subject is read by its id alone.
 *
 * Undo still happens from Home, through the person's own clients, so row level
 * security keeps it to their rows whatever wrote the record.
 *
 * Both helpers never throw, whatever they are handed: a test's stub client
 * without `schema`, an unreachable table, a failed insert. The write the run
 * made is what counts, and a record that cannot be kept is logged and dropped,
 * as recordDashAction already does.
 */

/** Anything with supabase-js's `schema`, as every service client has. */
type ServiceClient = { schema: (name: string) => unknown };

/** The deps recordDashAction takes, over a service client, for one account. */
export function scheduledDashDeps(client: unknown, userId: string, now?: () => string): DashActionDeps {
  const service = client as ServiceClient;
  const db = async (schema: AskSchema) => service.schema(schema) as SchemaClient;
  return {
    userId,
    core: service.schema('core') as SchemaClient,
    db,
    ...(now ? { now } : {}),
  };
}

/**
 * The row as it is, before a scheduled run changes it, for the record's
 * before values. Null when it could not be read, which leaves the record
 * without an Undo and never stops the write.
 */
export async function scheduledBefore(
  client: unknown,
  userId: string,
  ref: string,
): Promise<Record<string, unknown> | null> {
  try {
    return await readSubjectOrNull(scheduledDashDeps(client, userId), ref);
  } catch (error) {
    console.error(`scheduled action: could not read ${ref}`, error);
    return null;
  }
}

/** Record one change a scheduled run has just made. The record's id, or null. */
export async function recordScheduled(
  client: unknown,
  userId: string,
  entry: Omit<DashActionEntry, 'surface'>,
  now?: () => string,
): Promise<string | null> {
  try {
    return await recordDashAction(scheduledDashDeps(client, userId, now), { ...entry, surface: 'scheduled' });
  } catch (error) {
    console.error(`scheduled action: could not record ${entry.kind} on ${entry.subjectRef}`, error);
    return null;
  }
}
