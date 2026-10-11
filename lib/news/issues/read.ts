import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { NEWS_SCHEMA, type NewsSupabaseClient } from '@/lib/news/db/schema-name';

/**
 * When you opened it, set the first time and not moved afterwards.
 *
 * `read_at is null` in the filter is what makes it once: opening an issue you
 * read last week leaves the original time alone, so the column keeps saying
 * when you actually read it rather than when you last looked at it.
 *
 * Which row is touched is the policies' decision. The session client sees your
 * issues and nothing else, so an id from a URL can do nothing but miss.
 */
export async function markRead(client: NewsSupabaseClient, id: string): Promise<void> {
  const { error } = await client
    .from('issues')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null);
  assertSchemaExposed(error, NEWS_SCHEMA);
  if (error) throw new Error(`news: marking that newsletter read failed (${error.message})`);
}

/**
 * Note that the person pressed Confirm on a signup email (plan #1724).
 *
 * Only an issue that carries a stored link can be confirmed, and only once:
 * `confirmed_at is null` keeps the first time, as markRead keeps its own. The
 * app never visits the link, so this records a press and nothing more. The
 * `user_id` filter sits on top of the policies. Returns whether a row was
 * marked, so a repeat press, or one for an issue with no link, is a miss.
 */
export async function markConfirmed(
  client: NewsSupabaseClient,
  userId: string,
  id: string,
): Promise<boolean> {
  const { data, error } = await client
    .from('issues')
    .update({ confirmed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
    .is('confirmed_at', null)
    .not('confirm_url', 'is', null)
    .select('id');
  assertSchemaExposed(error, NEWS_SCHEMA);
  if (error) throw new Error(`news: marking that signup confirmed failed (${error.message})`);
  return (data ?? []).length > 0;
}

/** Back to unread:the time is cleared, and the home tile counts it again. */
export async function markUnread(client: NewsSupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('issues').update({ read_at: null }).eq('id', id);
  assertSchemaExposed(error, NEWS_SCHEMA);
  if (error) throw new Error(`news: marking that newsletter unread failed (${error.message})`);
}
