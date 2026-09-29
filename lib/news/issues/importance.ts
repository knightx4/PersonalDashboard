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
import { IMPORTANCE_ON_JEV, IMPORTANCE_QUESTION, ratingFromLevel, storyState } from './importance-jev';
import { applyRatings, unrated, type Unrated } from './importance-rows';

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
 *
 * For an account that opted in to Jev (plan #1170), each story is first put
 * to Jev as a score question (importance-jev.ts). A rating Jev is at least
 * 0.8 sure of is used, and only the stories left go to Haiku, in one call.
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

type Rating = { number: number; importance: number };

/** One Haiku call rating `stories`; the ratings as it gave them. Throws on a failed call. */
async function haikuRatings(
  client: Pick<Anthropic, 'messages'>,
  stories: readonly Unrated[],
  reports: SpendReport[],
): Promise<unknown> {
  const response = await client.messages.create({
    model: IMPORTANCE_MODEL,
    max_tokens: 2_000,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: forceTool(TOOL_NAME),
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
  return (block.input as { ratings?: unknown } | null)?.ratings;
}

/**
 * Each story put to Jev: the ratings Jev is sure enough of, and the stories
 * left for Haiku (those under the floor, and all of them when Jev fails).
 */
async function jevRatings(
  stories: readonly Unrated[],
  reports: SpendReport[],
  jev: { apiKey?: string | null; fetch?: typeof fetch },
): Promise<{ rated: Rating[]; rest: Unrated[] }> {
  type Route = { by: 'jev'; importance: number } | { by: 'haiku' };
  const routes = await Promise.all(
    stories.map((story) =>
      decideWithJev<typeof IMPORTANCE_QUESTION, Route>({
        state: storyState(story),
        question: IMPORTANCE_QUESTION,
        read: (answer) => ({ by: 'jev', importance: ratingFromLevel(answer.level) }),
        fallback: async () => ({ by: 'haiku' }),
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
      ? rated.push({ number: stories[i].index, importance: value.importance })
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
  let ratings: unknown = fromJev.rated;
  if (fromJev.rest.length > 0) {
    try {
      const fromHaiku = await haikuRatings(input.client, fromJev.rest, reports);
      ratings = [...fromJev.rated, ...(Array.isArray(fromHaiku) ? fromHaiku : [])];
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
