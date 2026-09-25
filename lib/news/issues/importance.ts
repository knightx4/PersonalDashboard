import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { NewsOperation } from '@/lib/core/spend/operations';
import { usageFrom, type SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import { forceTool } from '@/lib/learn/graph/tool-call';
import type { NewsSupabaseClient } from '@/lib/news/db/schema-name';
import { IMPORTANCE_RUBRIC } from './importance-rubric';
import { applyRatings, unrated } from './importance-rows';

/**
 * Rating the stories stored before importance existed.
 *
 * A newsletter summarised from now on gets a rating on every story from the
 * digest call itself (digest.ts). The ones already stored have none, and
 * summarising them again would clear their passes and story groups, since a
 * redo rewrites the stories array. So they are rated here instead: one short
 * Haiku call per newsletter reads only the headlines and summaries, and the
 * ratings are written into the stored stories where they sit, leaving every
 * position, and so every pass and group, as it was.
 *
 * Run by the hourly newsletter catch-up after it has summarised what is
 * pending (inngest/news/digest.ts), newest newsletters first, so the stories
 * Quick read shows are rated before the old ones. A newsletter whose first
 * story is rated is taken as done.
 */

export const IMPORTANCE_MODEL = 'claude-haiku-4-5';

/** The name this call has in core.model_spend. Stable: renaming it splits the history. */
export const IMPORTANCE_OPERATION: NewsOperation = 'score-importance';

const TOOL_NAME = 'report_importance';

const SYSTEM = `You rate the stories of one email newsletter. Each story is
given as its number, its topic, its headline and a short summary.

${IMPORTANCE_RUBRIC}

Rate every story you are given, by its number, in one call.`;

const TOOL = {
  name: TOOL_NAME,
  description: 'Report the importance of every story, by its number.',
  input_schema: {
    type: 'object' as const,
    properties: {
      ratings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            number: { type: 'integer' },
            importance: { type: 'integer', enum: [1, 2, 3, 4, 5] },
          },
          required: ['number', 'importance'],
        },
      },
    },
    required: ['ratings'],
  },
};

export type ScoreOutcome =
  | { status: 'scored'; rated: number }
  | { status: 'nothing-to-rate' }
  | { status: 'failed'; error: string };

/**
 * Rate one newsletter's unrated stories and write the ratings in. Throws only
 * when the row cannot be read or written; a failed call is returned. The spend
 * is recorded whether or not the reply was usable.
 *
 * `news` may be the service role, so every query names the account. Just
 * before writing, the stories are read again and the ratings applied to that
 * copy, matched by position and headline, so a story that changed in between
 * is left unrated rather than given another story's rating.
 */
export async function scoreIssueImportance(input: {
  news: NewsSupabaseClient;
  spend: Pick<CoreSupabaseClient, 'from'>;
  userId: string;
  issueId: string;
  client: Pick<Anthropic, 'messages'>;
}): Promise<ScoreOutcome> {
  const read = async () => {
    const { data, error } = await input.news
      .from('issues')
      .select('stories')
      .eq('id', input.issueId)
      .eq('user_id', input.userId)
      .maybeSingle();
    if (error) throw new Error(`news: reading stories to rate failed (${error.message})`);
    return (data?.stories as unknown) ?? null;
  };

  const todo = unrated(await read());
  if (!todo.length) return { status: 'nothing-to-rate' };

  const reports: SpendReport[] = [];
  let ratings: unknown;
  try {
    const response = await input.client.messages.create({
      model: IMPORTANCE_MODEL,
      max_tokens: 2_000,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: forceTool(TOOL_NAME),
      messages: [
        {
          role: 'user',
          content: todo
            .map((s) => `${s.index}. (${s.topic ?? 'no topic'}) ${s.headline}: ${s.summary}`)
            .join('\n'),
        },
      ],
    });
    reports.push({ model: IMPORTANCE_MODEL, usage: usageFrom(response.usage) });
    const block = response.content.find(
      (part) => part.type === 'tool_use' && part.name === TOOL_NAME,
    );
    if (!block || block.type !== 'tool_use') throw new Error('The model reported no ratings.');
    ratings = (block.input as { ratings?: unknown } | null)?.ratings;
  } catch (error) {
    await record(input, reports);
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
  await record(input, reports);

  const { stories, rated } = applyRatings(await read(), todo, ratings);
  if (!rated) return { status: 'failed', error: 'No usable rating came back.' };
  const saved = await input.news
    .from('issues')
    .update({ stories })
    .eq('id', input.issueId)
    .eq('user_id', input.userId);
  if (saved.error) throw new Error(`news: saving story ratings failed (${saved.error.message})`);
  return { status: 'scored', rated };
}

async function record(
  input: { spend: Pick<CoreSupabaseClient, 'from'>; userId: string },
  reports: SpendReport[],
): Promise<void> {
  for (const report of reports) {
    await recordSpend(input.spend, input.userId, {
      module: 'news',
      operation: IMPORTANCE_OPERATION,
      model: report.model,
      usage: report.usage,
    });
  }
}

/**
 * Summarised newsletters whose first story has no rating. PostgREST reads
 * `stories->0` as the first element; an essay's empty list has none and is
 * never picked.
 */
export const UNRATED_FILTER =
  'and(summary.not.is.null,stories->0.not.is.null,stories->0->>importance.is.null)';

export type ScoreTally = { scored: number; failed: number; left: number };

/**
 * Rate the stories of every summarised newsletter that has none yet, newest
 * first, across every account, starting none after `deadline`. A failed call
 * is counted and the run carries on; that newsletter is tried on a later run.
 */
export async function scorePending(input: {
  news: NewsSupabaseClient;
  spend: Pick<CoreSupabaseClient, 'from'>;
  anthropicApiKey: string;
  client?: Pick<Anthropic, 'messages'>;
  limit: number;
  deadline?: number;
  now?: () => number;
}): Promise<ScoreTally> {
  const { data, error } = await input.news
    .from('issues')
    .select('id, user_id')
    .or(UNRATED_FILTER)
    .order('received_at', { ascending: false })
    .limit(input.limit);
  if (error) throw new Error(`news: listing stories to rate failed (${error.message})`);

  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  const now = input.now ?? Date.now;
  const rows = data ?? [];
  const tally: ScoreTally = { scored: 0, failed: 0, left: 0 };
  for (const [index, row] of rows.entries()) {
    if (input.deadline !== undefined && now() >= input.deadline) {
      tally.left = rows.length - index;
      break;
    }
    const outcome = await scoreIssueImportance({
      news: input.news,
      spend: input.spend,
      userId: row.user_id as string,
      issueId: row.id as string,
      client,
    });
    if (outcome.status === 'scored') tally.scored += 1;
    if (outcome.status === 'failed') {
      tally.failed += 1;
      console.warn(`news: rating the stories of issue ${row.id} failed (${outcome.error})`);
    }
  }
  return tally;
}
