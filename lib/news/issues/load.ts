import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { NEWS_SCHEMA, type NewsSupabaseClient } from '@/lib/news/db/schema-name';
import type { NewsIssue, NewsSender } from './list';

/**
 * How many issues one page holds.
 *
 * A newsletter list is read from the top and abandoned somewhere down it, so
 * the cap is a page size rather than a limit on what is kept. Everything older
 * is still in the table and still counted by the home tile.
 */
const PAGE = 200;

/**
 * Everyone who has written to your address.
 *
 * Read whole: it is one row per newsletter rather than per message, so even a
 * heavy year of signups is a short list, and the column needs all of it to
 * offer a filter for a sender whose issues are muted out of the list.
 */
export async function loadSenders(client: NewsSupabaseClient): Promise<NewsSender[]> {
  const { data, error } = await client.from('senders').select('id, email, name, muted');
  assertSchemaExposed(error, NEWS_SCHEMA);
  if (error) throw new Error(`news: reading your senders failed (${error.message})`);
  return (data ?? []) as NewsSender[];
}

/** What has arrived, newest first. Muting is applied in visibleIssues, not here. */
export async function loadIssues(client: NewsSupabaseClient): Promise<NewsIssue[]> {
  const { data, error } = await client
    .from('issues')
    .select('id, sender_id, subject, received_at, read_at')
    .order('received_at', { ascending: false })
    .limit(PAGE);
  assertSchemaExposed(error, NEWS_SCHEMA);
  if (error) throw new Error(`news: reading your newsletters failed (${error.message})`);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    senderId: row.sender_id as string,
    subject: (row.subject as string | null) ?? null,
    receivedAt: row.received_at as string,
    readAt: (row.read_at as string | null) ?? null,
  }));
}

/** One newsletter with its bodies, which is what the reading page needs. */
export type NewsIssueDetail = {
  id: string;
  subject: string | null;
  receivedAt: string;
  readAt: string | null;
  textBody: string | null;
  htmlBody: string | null;
  sender: NewsSender | null;
};

/**
 * One issue, by id, or null when there is no such issue for this account.
 *
 * Null covers three cases the page treats the same way: an id that is not a
 * uuid, an id that belongs to nobody, and an id that belongs to another
 * account. The third is the policies' doing rather than this function's -- the
 * session client cannot see another account's rows, so the read comes back
 * empty exactly as it does for an id that does not exist.
 *
 * The sender is a second query rather than an embed. The link is a composite
 * foreign key carrying user_id, and asking PostgREST to follow one of those is
 * more indirection than a second read by primary key is worth.
 */
export async function loadIssue(
  client: NewsSupabaseClient,
  id: string,
): Promise<NewsIssueDetail | null> {
  const { data, error } = await client
    .from('issues')
    .select('id, sender_id, subject, received_at, read_at, text_body, html_body')
    .eq('id', id)
    .maybeSingle();
  assertSchemaExposed(error, NEWS_SCHEMA);
  if (error || !data) return null;

  const row = data as {
    id: string;
    sender_id: string;
    subject: string | null;
    received_at: string;
    read_at: string | null;
    text_body: string | null;
    html_body: string | null;
  };

  const { data: senderRow } = await client
    .from('senders')
    .select('id, email, name, muted')
    .eq('id', row.sender_id)
    .maybeSingle();

  return {
    id: row.id,
    subject: row.subject ?? null,
    receivedAt: row.received_at,
    readAt: row.read_at ?? null,
    textBody: row.text_body ?? null,
    htmlBody: row.html_body ?? null,
    sender: (senderRow as NewsSender | null) ?? null,
  };
}
