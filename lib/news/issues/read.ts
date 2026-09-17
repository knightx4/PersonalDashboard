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

/** Back to unread: the time is cleared, and the home tile counts it again. */
export async function markUnread(client: NewsSupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('issues').update({ read_at: null }).eq('id', id);
  assertSchemaExposed(error, NEWS_SCHEMA);
  if (error) throw new Error(`news: marking that newsletter unread failed (${error.message})`);
}
