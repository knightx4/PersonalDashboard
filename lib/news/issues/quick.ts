import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { NEWS_SCHEMA, type NewsSupabaseClient } from '@/lib/news/db/schema-name';
import {
  issueFinished,
  type QuickIssue,
  type QuickSignals,
  type StoryGroupRow,
  type StoryPass,
} from '@/lib/news/quick/next';
import type { InterestRow } from '@/lib/news/quick/rank';
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
 * Issues whose story groups are read in one request. PostgREST returns at
 * most 1000 rows to a read, and forty newsletters at the five stories each
 * they average is about 200, well clear of it even for a long one.
 */
const GROUP_CHUNK = 40;

/**
 * What Quick read ranks with (lib/news/quick/rank.ts): which of these
 * newsletters' stories are the same event, from news.story_groups, and what
 * you have opened and saved, from the news.story_interest view.
 *
 * Ranking is an improvement on the order, never a condition for it: when
 * either read fails the page still works, with nothing folded or no lean, so
 * failures here are swallowed rather than thrown.
 */
export async function loadQuickSignals(
  client: NewsSupabaseClient,
  issues: readonly QuickIssue[],
): Promise<QuickSignals> {
  const ids = issues.map((issue) => issue.id);
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += GROUP_CHUNK) chunks.push(ids.slice(i, i + GROUP_CHUNK));

  const [groupReads, interest] = await Promise.all([
    Promise.all(
      chunks.map((chunk) =>
        client.from('story_groups').select('issue_id, story_index, group_id').in('issue_id', chunk),
      ),
    ),
    client.from('story_interest').select('sender_id, topic, seen, opened, saved'),
  ]);

  const groups: StoryGroupRow[] = groupReads.flatMap((read) =>
    read.error
      ? []
      : ((read.data ?? []) as { issue_id: string; story_index: number; group_id: string }[]).map(
          (row) => ({ issueId: row.issue_id, storyIndex: row.story_index, groupId: row.group_id }),
        ),
  );
  const rows: InterestRow[] = interest.error
    ? []
    : (
        (interest.data ?? []) as {
          sender_id: string;
          topic: string | null;
          seen: number;
          opened: number;
          saved: number;
        }[]
      ).map((row) => ({
        senderId: row.sender_id,
        topic: row.topic,
        seen: Number(row.seen) || 0,
        opened: Number(row.opened) || 0,
        saved: Number(row.saved) || 0,
      }));
  return { groups, interest: rows };
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

  return { finished: await finishIfDone(client, issueId) };
}

/**
 * Record that you moved past a whole page of stories (plan #939: Next page
 * marks every story on it), and mark each newsletter on the page read once
 * nothing of it is left.
 *
 * One upsert for the page, with the same key and duplicate rule as passStory,
 * then the finished check once per newsletter rather than once per story.
 * Returns whether any newsletter was finished, so the caller knows to refresh
 * the list.
 */
export async function passStories(
  client: NewsSupabaseClient,
  { userId, stories }: { userId: string; stories: readonly StoryPass[] },
): Promise<{ finished: boolean }> {
  if (!stories.length) return { finished: false };
  const recorded = await client.from('story_passes').upsert(
    stories.map((story) => ({
      user_id: userId,
      issue_id: story.issueId,
      story_index: story.storyIndex,
    })),
    { onConflict: 'issue_id,story_index', ignoreDuplicates: true },
  );
  assertSchemaExposed(recorded.error, NEWS_SCHEMA);
  if (recorded.error) {
    throw new Error(`news: recording those stories failed (${recorded.error.message})`);
  }

  const issueIds = [...new Set(stories.map((story) => story.issueId))];
  const finished = await Promise.all(issueIds.map((issueId) => finishIfDone(client, issueId)));
  return { finished: finished.some(Boolean) };
}

/**
 * Read one newsletter and its passes again, rather than trusting the page, and
 * mark it read when every card it makes has been passed. markRead leaves a
 * newsletter already read alone.
 */
async function finishIfDone(client: NewsSupabaseClient, issueId: string): Promise<boolean> {
  const [issue, passes] = await Promise.all([
    client.from('issues').select(QUICK_COLUMNS).eq('id', issueId).maybeSingle(),
    client.from('story_passes').select('issue_id, story_index').eq('issue_id', issueId),
  ]);
  if (issue.error || !issue.data || passes.error) return false;

  const finished = issueFinished(toQuickIssue(issue.data as QuickRow), toPasses(passes.data));
  if (finished) await markRead(client, issueId);
  return finished;
}

/**
 * Record that you opened a story's article: a pass, as passStory writes it,
 * with opened_at set, which Quick read's ranking reads as interest
 * (supabase/migrations-news/0013_story_interest.sql). A story already passed
 * keeps its first passed_at, and a second open keeps the first opened_at.
 */
export async function openStory(
  client: NewsSupabaseClient,
  { userId, issueId, storyIndex }: { userId: string; issueId: string; storyIndex: number },
): Promise<{ finished: boolean }> {
  const { finished } = await passStory(client, { userId, issueId, storyIndex });
  const opened = await client
    .from('story_passes')
    .update({ opened_at: new Date().toISOString() })
    .eq('issue_id', issueId)
    .eq('story_index', storyIndex)
    .is('opened_at', null);
  assertSchemaExposed(opened.error, NEWS_SCHEMA);
  if (opened.error) {
    throw new Error(`news: recording that you opened that story failed (${opened.error.message})`);
  }
  return { finished };
}
