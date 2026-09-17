import 'server-only';

import { randomLocalPart } from '@/lib/news/address';
import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { NEWS_SCHEMA, type NewsSupabaseClient } from '@/lib/news/db/schema-name';

/** Postgres' unique violation: somebody else's request wrote the row first. */
const UNIQUE_VIOLATION = '23505';

/**
 * The account's local part, made on first sight if it has none.
 *
 * There is no seeding step and no button to press before the workspace works:
 * opening News settings for the first time is what creates the address. Two
 * requests arriving together is the one case worth handling, and the loser
 * reads the row the winner wrote rather than showing an error.
 *
 * The client is the session one, so the policies decide which row this is.
 */
export async function loadOrCreateLocalPart(
  client: NewsSupabaseClient,
  userId: string,
): Promise<string> {
  const existing = await client.from('addresses').select('local_part').maybeSingle();
  assertSchemaExposed(existing.error, NEWS_SCHEMA);
  if (existing.error) throw new Error(`news: reading your address failed (${existing.error.message})`);
  if (existing.data) return existing.data.local_part as string;

  const created = await client
    .from('addresses')
    .insert({ user_id: userId, local_part: randomLocalPart() })
    .select('local_part')
    .single();
  if (!created.error) return created.data.local_part as string;
  if (created.error.code !== UNIQUE_VIOLATION) {
    throw new Error(`news: making your address failed (${created.error.message})`);
  }

  const retried = await client.from('addresses').select('local_part').single();
  if (retried.error) throw new Error(`news: reading your address failed (${retried.error.message})`);
  return retried.data.local_part as string;
}

/**
 * Swap the address for a new one.
 *
 * An update of the one row, which is what makes the old address stop working
 * the moment the new one exists: delivery looks the recipient up in this
 * table, so there is no window in which both are live and nothing to clean up
 * afterwards. Issues already stored are untouched -- they arrived, and which
 * address they came in on is not something the list asks.
 */
export async function replaceLocalPart(client: NewsSupabaseClient): Promise<string> {
  const localPart = randomLocalPart();
  const { data, error } = await client
    .from('addresses')
    .update({ local_part: localPart })
    .select('local_part')
    .single();
  assertSchemaExposed(error, NEWS_SCHEMA);
  if (error) throw new Error(`news: replacing your address failed (${error.message})`);
  return data.local_part as string;
}
