import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { NEWS_SCHEMA, type NewsSupabaseClient } from '@/lib/news/db/schema-name';
import type { NewsIssue, NewsSender, UnreadStories } from './list';
import { readStories, type NewsStory } from './stories';
import type { NewsTopic } from './topics';

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

/**
 * What has arrived, newest first. Muting is applied in visibleIssues, not here.
 *
 * With a topic, only newsletters with at least one story tagged with it
 * (plan #860). The match is jsonb containment on the stories column, so the
 * stories themselves are not read for the list; topics are stored as the
 * exact names in NEWS_TOPICS, which the summariser writes through readTopic.
 */
export async function loadIssues(
  client: NewsSupabaseClient,
  { topic = null }: { topic?: NewsTopic | null } = {},
): Promise<NewsIssue[]> {
  let query = client.from('issues').select('id, sender_id, subject, received_at, read_at, summary_line');
  if (topic) query = query.contains('stories', JSON.stringify([{ topic }]));
  const { data, error } = await query.order('received_at', { ascending: false }).limit(PAGE);
  assertSchemaExposed(error, NEWS_SCHEMA);
  if (error) throw new Error(`news: reading your newsletters failed (${error.message})`);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    senderId: row.sender_id as string,
    subject: (row.subject as string | null) ?? null,
    receivedAt: row.received_at as string,
    readAt: (row.read_at as string | null) ?? null,
    summaryLine: (row.summary_line as string | null) ?? null,
  }));
}

/** One newsletter with its bodies, which is what the reading page needs. */
/**
 * The stories of every unread newsletter, for the list's topic chips
 * (unreadTopics in list.ts). Only unread ones are read, so this stays small
 * however long the list grows.
 */
export async function loadUnreadStories(client: NewsSupabaseClient): Promise<UnreadStories[]> {
  const { data, error } = await client
    .from('issues')
    .select('sender_id, stories')
    .is('read_at', null)
    .not('summary', 'is', null)
    .limit(PAGE);
  assertSchemaExposed(error, NEWS_SCHEMA);
  if (error) throw new Error(`news: reading your unread newsletters failed (${error.message})`);
  return (data ?? []).map((row) => ({
    senderId: row.sender_id as string,
    stories: row.stories as unknown,
  }));
}

export type NewsIssueDetail = {
  id: string;
  subject: string | null;
  receivedAt: string;
  readAt: string | null;
  textBody: string | null;
  htmlBody: string | null;
  sender: NewsSender | null;
  /**
   * The page the publisher offered for unsubscribing, or null when it offered
   * none. Stored as the header spelled it, so it is either `https://…` or
   * `http://…`; the reading page opens it in a new tab.
   */
  unsubscribeUrl: string | null;
  /**
   * The address the publisher offered instead, with the `mailto:` scheme
   * stripped and any query string kept on the end, or null when it offered
   * none: `unsub@thepaper.com?subject=unsubscribe%20me`.
   *
   * Nothing reads this yet. #615 settled that an address-only newsletter is
   * unsubscribed by the app sending the mail through Mailgun, and #667 is the
   * step that does it, off this field.
   */
  unsubscribeEmail: string | null;
  /**
   * When this account asked to be unsubscribed from this newsletter, or null
   * while it has not asked.
   *
   * Nothing writes it yet, and nothing reads it yet either. #667 is the step
   * that sets it when the button is pressed and shows that it was, instead of
   * offering the button a second time.
   */
  unsubscribeSentAt: string | null;
  /**
   * The issue's summary and stories, or null while it has not been
   * summarised. #786 writes them; an issue that is one long essay has a
   * summary and an empty story list.
   */
  digest: { summary: string; stories: NewsStory[] } | null;
  /**
   * Why the last attempt to summarise this issue failed, or null when it
   * succeeded or none has run. The page shows the original email when it is
   * set.
   */
  digestError: string | null;
};

/**
 * The columns loadIssue reads, on one line and over the print width.
 *
 * Joining two shorter strings with `+` widens the type from the literal to
 * `string`, and supabase-js then types the result as GenericStringError rather
 * than as a row, because it parses the select list out of the literal. There
 * is no generated Database type for the news schema, so this list and the row
 * type inside loadIssue are the only places the issue's shape is written down.
 */
const ISSUE_DETAIL_COLUMNS =
  'id, sender_id, subject, received_at, read_at, text_body, html_body, unsubscribe_url, unsubscribe_email, unsubscribe_sent_at, summary, stories, digest_error';

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
    .select(ISSUE_DETAIL_COLUMNS)
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
    unsubscribe_url: string | null;
    unsubscribe_email: string | null;
    unsubscribe_sent_at: string | null;
    summary: string | null;
    stories: unknown;
    digest_error: string | null;
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
    unsubscribeUrl: row.unsubscribe_url ?? null,
    unsubscribeEmail: row.unsubscribe_email ?? null,
    unsubscribeSentAt: row.unsubscribe_sent_at ?? null,
    digest: row.summary ? { summary: row.summary, stories: readStories(row.stories) } : null,
    digestError: row.digest_error ?? null,
  };
}
