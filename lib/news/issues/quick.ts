import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { NEWS_SCHEMA, type NewsSupabaseClient } from '@/lib/news/db/schema-name';
import { issueFinished, type QuickIssue, type StoryPass } from '@/lib/news/quick/next';
import { markRead } from './read';

/**
 * How many newsletters Quick read looks through, newest first.
 *
 * Fewer than the list's page of 200, because the passes for them are read by
 * naming each newsletter in the query, and PostgREST returns at most 1000 rows
 * to one read. A hundred newsletters at the five stories each they average
 * today is about 500 passes. A newsletter older than the hundredth is not
 * shown in Quick read; it is still in the list.
 */
const QUICK_PAGE = 100;

/**
 * The columns a Quick read newsletter is read with, on one line for the reason
 * given on ISSUE_DETAIL_COLUMNS in load.ts.
 */
const QUICK_COLUMNS = 'id, sender_id, subject, received_at, summary, stories';

type QuickRow = {
  id: string;
  sender_id: string;
  subject: string | null;
  received_at: string;
  summary: string | null;
  stories: unknown;
};

function toQuickIssue(row: QuickRow): QuickIssue {
  return {
    id: row.id,
    senderId: row.sender_id,
    subject: row.subject ?? null,
    receivedAt: row.received_at,
    summary: row.summary ?? null,
    // As stored: a pass is keyed on the position in this array, so it is not
    // run through readStories here. nextCard does that per entry.
    stories: row.stories,
  };
}

function toPasses(rows: { issue_id: string; story_index: number }[] | null): StoryPass[] {
  return (rows ?? []).map((row) => ({ issueId: row.issue_id, storyIndex: row.story_index }));
}

/**
 * The summarised newsletters, newest first, and every story passed in them.
 *
 * Muting is not applied here: nextCard applies it from the senders, so they
 * are loaded unfiltered by loadSenders in load.ts.
 */
export async function loadQuickRead(
  client: NewsSupabaseClient,
): Promise<{ issues: QuickIssue[]; passes: StoryPass[] }> {
  const { data, error } = await client
    .from('issues')
    .select(QUICK_COLUMNS)
    .not('summary', 'is', null)
    .order('received_at', { ascending: false })
    .limit(QUICK_PAGE);
  assertSchemaExposed(error, NEWS_SCHEMA);
  if (error) throw new Error(`news: reading your newsletters failed (${error.message})`);

  const issues = ((data ?? []) as QuickRow[]).map(toQuickIssue);
  if (!issues.length) return { issues, passes: [] };

  const passes = await client
    .from('story_passes')
    .select('issue_id, story_index')
    .in(
      'issue_id',
      issues.map((issue) => issue.id),
    );
  assertSchemaExposed(passes.error, NEWS_SCHEMA);
  if (passes.error) {
    throw new Error(`news: reading the stories you have passed failed (${passes.error.message})`);
  }
  return { issues, passes: toPasses(passes.data) };
}

/**
 * Record that you moved past one story, and mark its newsletter read once
 * nothing of it is left.
 *
 * The record is an upsert onto the (issue, position) key that ignores a
 * duplicate, so pressing Next twice, or opening the article and then pressing
 * Next, keeps one row with the first time. `userId` is written explicitly
 * because the table's policy checks it equals the session's user; it comes
 * from the session, never from the form.
 *
 * The newsletter and its passes are then read again, rather than trusted from
 * the page, so the read mark follows what the database holds. markRead leaves
 * a newsletter already read alone. Returns whether the newsletter is finished.
 */
export async function passStory(
  client: NewsSupabaseClient,
  { userId, issueId, storyIndex }: { userId: string; issueId: string; storyIndex: number },
): Promise<{ finished: boolean }> {
  const recorded = await client
    .from('story_passes')
    .upsert(
      { user_id: userId, issue_id: issueId, story_index: storyIndex },
      { onConflict: 'issue_id,story_index', ignoreDuplicates: true },
    );
  assertSchemaExposed(recorded.error, NEWS_SCHEMA);
  if (recorded.error) {
    throw new Error(`news: recording that story failed (${recorded.error.message})`);
  }

  const [issue, passes] = await Promise.all([
    client.from('issues').select(QUICK_COLUMNS).eq('id', issueId).maybeSingle(),
    client.from('story_passes').select('issue_id, story_index').eq('issue_id', issueId),
  ]);
  if (issue.error || !issue.data || passes.error) return { finished: false };

  const finished = issueFinished(toQuickIssue(issue.data as QuickRow), toPasses(passes.data));
  if (finished) await markRead(client, issueId);
  return { finished };
}
