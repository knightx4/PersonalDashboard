import 'server-only';

import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { embedTexts } from '@/lib/learn/embed/embed';
import { vectorLiteral } from '@/lib/learn/catalogue/embed-sweep';
import type { NewsSupabaseClient } from '@/lib/news/db/schema-name';
import { cosine, repeatText, REPEAT_WINDOW_MS } from './repeats';
import { readStories } from './stories';

/**
 * Recording which stories are the same event (plan #864, under #862).
 *
 * Runs after a newsletter is summarised. Each of its stories is embedded from
 * its headline and summary and compared with the stored stories of other
 * newsletters that arrived within two days of it. A story at or above
 * STORY_MATCH_CUTOFF joins the group of its closest match; one below it starts
 * a group of its own. Either way it gets a row in news.story_groups
 * (supabase/migrations-news/0010_story_groups.sql) holding its vector, so the
 * next newsletter is compared against it without embedding it again.
 *
 * One embedding call per issue, which is what the Voyage key's rate allows.
 * An issue whose stories cannot be embedded is left without rows: it is then
 * matched with nothing, and later newsletters are not matched against it.
 */

/**
 * The similarity at or above which two stories are the same event.
 *
 * #873 chose strict from #872's measurement: across a week of 139 stories
 * from 10 newsletters, all 8 pairs at 0.80 and above were the same event, and
 * the pairs from 0.75 to 0.80 were different stories.
 */
export const STORY_MATCH_CUTOFF = 0.8;

/** The name this call has in core.model_spend. Stable: renaming it splits the history. */
export const GROUP_OPERATION = 'group-stories';

/** A stored story from another newsletter, as the comparison needs it. */
export type GroupCandidate = { groupId: string; vector: number[] };

/** Where one new story goes: a group it matched, or null to start its own. */
export type StoryMatch = { groupId: string; similarity: number } | null;

/**
 * For each new story, the candidate it is most alike, when that is at or
 * above `cutoff`. Pure, so the choice can be tested without a database.
 */
export function matchStories(
  vectors: number[][],
  candidates: GroupCandidate[],
  cutoff: number = STORY_MATCH_CUTOFF,
): StoryMatch[] {
  return vectors.map((vector) => {
    let best: StoryMatch = null;
    for (const candidate of candidates) {
      const similarity = cosine(vector, candidate.vector);
      if (similarity >= cutoff && (best === null || similarity > best.similarity)) {
        best = { groupId: candidate.groupId, similarity };
      }
    }
    return best;
  });
}

/** A vector as PostgREST returns it: the text `[1,2,3]`, or already an array. */
function readVector(value: unknown): number[] | null {
  const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  return Array.isArray(parsed) && parsed.every((n) => typeof n === 'number') ? parsed : null;
}

export type GroupOutcome =
  | { status: 'grouped'; stories: number; matched: number }
  | { status: 'no-stories' }
  | { status: 'not-embedded'; reason: string };

/**
 * Group one summarised issue's stories. Throws only when a row cannot be read
 * or written; an embedding that fails is returned as `not-embedded` and the
 * issue is left ungrouped. The spend is recorded under module 'news' whether
 * the vectors were usable or not.
 *
 * `news` may be the service-role client, so every query names the account.
 * Rows already stored for this issue are overwritten by position; digestIssue
 * clears them before a new summary is grouped.
 */
export async function groupStories(input: {
  news: NewsSupabaseClient;
  spend: Pick<CoreSupabaseClient, 'from'>;
  userId: string;
  issueId: string;
  embed?: typeof embedTexts;
  newGroupId?: () => string;
}): Promise<GroupOutcome> {
  const { data: issue, error } = await input.news
    .from('issues')
    .select('sender_id, received_at, stories')
    .eq('id', input.issueId)
    .eq('user_id', input.userId)
    .maybeSingle();
  if (error) throw new Error(`news: reading the issue to group failed (${error.message})`);
  const stories = readStories(issue?.stories);
  if (!issue || stories.length === 0) return { status: 'no-stories' };

  const reports: SpendReport[] = [];
  const embedded = await (input.embed ?? embedTexts)({
    texts: stories.map(repeatText),
    inputType: 'document',
    onSpend: (report) => reports.push(report),
  });
  for (const report of reports) {
    await recordSpend(input.spend, input.userId, {
      module: 'news',
      operation: GROUP_OPERATION,
      model: report.model,
      usage: report.usage,
    });
  }
  if (!embedded.ok) return { status: 'not-embedded', reason: `${embedded.reason}: ${embedded.detail}` };

  // Other newsletters' issues from two days either side. The same newsletter
  // is never a repeat of itself, as in #872's measurement.
  const receivedAt = Date.parse(issue.received_at as string);
  const nearby = await input.news
    .from('issues')
    .select('id')
    .eq('user_id', input.userId)
    .neq('sender_id', issue.sender_id as string)
    .gte('received_at', new Date(receivedAt - REPEAT_WINDOW_MS).toISOString())
    .lte('received_at', new Date(receivedAt + REPEAT_WINDOW_MS).toISOString());
  if (nearby.error) throw new Error(`news: listing nearby issues failed (${nearby.error.message})`);
  const nearbyIds = (nearby.data ?? []).map((row: { id: string }) => row.id);

  const candidates: GroupCandidate[] = [];
  if (nearbyIds.length > 0) {
    const stored = await input.news
      .from('story_groups')
      .select('group_id, embedding')
      .eq('user_id', input.userId)
      .in('issue_id', nearbyIds);
    if (stored.error) throw new Error(`news: reading stored stories failed (${stored.error.message})`);
    for (const row of stored.data ?? []) {
      const vector = readVector(row.embedding);
      if (vector) candidates.push({ groupId: row.group_id as string, vector });
    }
  }

  const newGroupId = input.newGroupId ?? (() => crypto.randomUUID());
  const matches = matchStories(embedded.vectors, candidates);
  const rows = matches.map((match, index) => ({
    user_id: input.userId,
    issue_id: input.issueId,
    story_index: index,
    group_id: match?.groupId ?? newGroupId(),
    similarity: match?.similarity ?? null,
    embedding: vectorLiteral(embedded.vectors[index]),
    embedding_model: embedded.model,
  }));
  const saved = await input.news
    .from('story_groups')
    .upsert(rows, { onConflict: 'issue_id,story_index' });
  if (saved.error) throw new Error(`news: saving story groups failed (${saved.error.message})`);

  return {
    status: 'grouped',
    stories: rows.length,
    matched: matches.filter((match) => match !== null).length,
  };
}
