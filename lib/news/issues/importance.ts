import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { NewsOperation } from '@/lib/core/spend/operations';
import { sumByModel, usageFrom, type SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import { decideWithJev } from '@/lib/jev/decide';
import { jevEnabledFor } from '@/lib/jev/enabled';
import { forceTool } from '@/lib/learn/graph/tool-call';
import type { NewsSupabaseClient } from '@/lib/news/db/schema-name';
import { IMPORTANCE_RUBRIC } from './importance-rubric';
import {
  IMPORTANCE_ON_JEV,
  IMPORTANCE_QUESTION,
  ratingFromHaiku,
  ratingFromScore,
  storyState,
} from './importance-jev';
import { applyRatings, unrated, type Unrated } from './importance-rows';
import { MODELS } from '@/lib/core/models';

/**
 * Rating how much each story matters, out of 100 (plan #1170).
 *
 * Every story is put to Jev as a score question (importance-jev.ts), one
 * story at a time and all of a newsletter's at once. Jev's answer is used
 * whatever its confidence. The stories Jev could not answer, because the call
 * failed or the account has not opted in to Jev, go to Haiku in one call
 * against the rubric in importance-rubric.ts, and its 1 to 5 is put on the
 * same scale. The ratings are written into the stored stories where they sit,
 * leaving every position, and so every pass and group, as it was.
 *
 * Two ways in. rateNewIssue runs as soon as a new newsletter is summarised
 * (summarise.ts). scorePending is the hourly catch-up (inngest/news/digest.ts)
 * for any newsletter whose stories have no rating: one whose rating failed on
 * arrival, and those rated before ratings were out of 100. It takes the newest
 * first, so the stories Quick read shows are rated before the old ones. A
 * newsletter whose first story is rated is taken as done.
 */

export const IMPORTANCE_MODEL = MODELS.newsImportance;

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

type Rating = { number: number; rating: number };

/**
 * One Haiku call rating `stories`, each put on the 0 to 100 scale. A rating
 * that is not a whole number from 1 to 5 is dropped. Throws on a failed call.
 */
async function haikuRatings(
  client: Pick<Anthropic, 'messages'>,
  stories: readonly Unrated[],
  reports: SpendReport[],
): Promise<Rating[]> {
  const response = await client.messages.create({
    model: IMPORTANCE_MODEL,
    max_tokens: 2_000,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: forceTool(TOOL_NAME, IMPORTANCE_MODEL),
    messages: [
      {
        role: 'user',
        content: stories
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
  const given = (block.input as { ratings?: unknown } | null)?.ratings;
  const ratings: Rating[] = [];
  for (const item of Array.isArray(given) ? given : []) {
    const { number, importance } = (item ?? {}) as Record<string, unknown>;
    if (typeof number !== 'number' || typeof importance !== 'number') continue;
    if (!Number.isInteger(importance) || importance < 1 || importance > 5) continue;
    ratings.push({ number, rating: ratingFromHaiku(importance) });
  }
  return ratings;
}

/**
 * Each story put to Jev: the ratings it gave, and the stories left for Haiku
 * (those whose call failed). No answer goes to Haiku for its confidence.
 */
async function jevRatings(
  stories: readonly Unrated[],
  reports: SpendReport[],
  jev: { apiKey?: string | null; fetch?: typeof fetch },
): Promise<{ rated: Rating[]; rest: Unrated[] }> {
  type Route = { by: 'jev'; rating: number } | { by: 'haiku' };
  const routes = await Promise.all(
    stories.map((story) =>
      decideWithJev<typeof IMPORTANCE_QUESTION, Route>({
        state: storyState(story),
        question: IMPORTANCE_QUESTION,
        read: (answer) => ({ by: 'jev', rating: ratingFromScore(answer.score) }),
        fallback: async () => ({ by: 'haiku' }),
        floor: 0,
        onSpend: (report) => reports.push(report),
        apiKey: jev.apiKey,
        fetch: jev.fetch,
      }),
    ),
  );
  const rated: Rating[] = [];
  const rest: Unrated[] = [];
  routes.forEach(({ value }, i) =>
    value.by === 'jev'
      ? rated.push({ number: stories[i].index, rating: value.rating })
      : rest.push(stories[i]),
  );
  return { rated, rest };
}

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
  /** Whether this account's stories may go to Jev (jevEnabledFor). Defaults to false. */
  jevEnabled?: boolean;
  jevApiKey?: string | null;
  jevFetch?: typeof fetch;
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
  const fromJev =
    IMPORTANCE_ON_JEV && input.jevEnabled
      ? await jevRatings(todo, reports, { apiKey: input.jevApiKey, fetch: input.jevFetch })
      : { rated: [], rest: todo };
  let ratings: Rating[] = fromJev.rated;
  if (fromJev.rest.length > 0) {
    try {
      ratings = [...fromJev.rated, ...(await haikuRatings(input.client, fromJev.rest, reports))];
    } catch (error) {
      // Jev's ratings are not written either: the catch-up takes a newsletter
      // whose first story is rated as done, so a half-rated one would keep
      // its unrated stories for good. The next run asks both again.
      await record(input, reports);
      return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
    }
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
  for (const report of sumByModel(reports)) {
    await recordSpend(input.spend, input.userId, {
      module: 'news',
      operation: IMPORTANCE_OPERATION,
      model: report.model,
      usage: report.usage,
    });
  }
}

/**
 * Rate a newsletter that has just been summarised. Never throws: the summary
 * is saved and readable without ratings, and a newsletter left unrated is
 * picked up by the hourly catch-up.
 */
export async function rateNewIssue(input: {
  news: NewsSupabaseClient;
  spend: Pick<CoreSupabaseClient, 'from'>;
  userId: string;
  issueId: string;
  anthropicApiKey: string;
  client?: Pick<Anthropic, 'messages'>;
  jevEnabled?: boolean;
  jevFetch?: typeof fetch;
}): Promise<ScoreOutcome | 'error'> {
  try {
    const outcome = await scoreIssueImportance({
      news: input.news,
      spend: input.spend,
      userId: input.userId,
      issueId: input.issueId,
      client: input.client ?? new Anthropic({ apiKey: input.anthropicApiKey }),
      jevEnabled: input.jevEnabled ?? (await jevEnabledFor(input.spend, input.userId)),
      jevFetch: input.jevFetch,
    });
    if (outcome.status === 'failed') {
      console.warn(`news: rating the stories of issue ${input.issueId} failed (${outcome.error})`);
    }
    return outcome;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`news: rating the stories of issue ${input.issueId} stopped (${message})`);
    return 'error';
  }
}

/**
 * Summarised newsletters whose first story has no rating. PostgREST reads
 * `stories->0` as the first element; an essay's empty list has none and is
 * never picked.
 */
export const UNRATED_FILTER =
  'and(summary.not.is.null,stories->0.not.is.null,stories->0->>rating.is.null)';

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
  /** Whether an account's stories may go to Jev. Defaults to jevEnabledFor on `spend`. */
  jevEnabled?: (userId: string) => Promise<boolean>;
  jevApiKey?: string | null;
  jevFetch?: typeof fetch;
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
  const jevOn = new Map<string, Promise<boolean>>();
  const enabledFor = (userId: string) => {
    let on = jevOn.get(userId);
    if (!on) {
      on = input.jevEnabled ? input.jevEnabled(userId) : jevEnabledFor(input.spend, userId);
      jevOn.set(userId, on);
    }
    return on;
  };
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
      jevEnabled: await enabledFor(row.user_id as string),
      jevApiKey: input.jevApiKey,
      jevFetch: input.jevFetch,
    });
    if (outcome.status === 'scored') tally.scored += 1;
    if (outcome.status === 'failed') {
      tally.failed += 1;
      console.warn(`news: rating the stories of issue ${row.id} failed (${outcome.error})`);
    }
  }
  return tally;
}
