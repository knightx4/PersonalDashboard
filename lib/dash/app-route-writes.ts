import type Anthropic from '@anthropic-ai/sdk';
import type { PostChangeInput, PostChangeKind } from '@/lib/ask/post-changes';
import { toRef } from '@/lib/core/refs';
import { fieldIsTrue, POLL_EVERY_SECONDS, POLL_MAX_MINUTES, type AppRouteQuery, type AppRouteResult } from '@/lib/dev/app-route';
import { finishComment, numbersLine, type AppRoutePoll, type PollFinish } from '@/lib/dev/app-route-polls';
import { planHref, raiseAnchor } from '@/lib/search/sources/dev-map';
import { noButton } from './runs';
import type { DashWriteContext, DashWriteResult, DashWriteTool } from './registry';

/**
 * Running one of the app's own routes from a chat (plan #3070.3, under
 * #3070):
 *
 *   run_app_route  calls GET /api/cron/<name> on the app's own domain
 *                  through lib/dev/app-route.ts, which attaches CRON_SECRET
 *                  on the server, so the secret never reaches the model, the
 *                  chat or a log. With poll_until it keeps polling in the
 *                  background, every poll_every_seconds for at most
 *                  max_minutes (an app_route_polls row the pg_cron pass in
 *                  lib/dev/app-route-polls.ts works), and when the field is
 *                  true or time runs out the final JSON and its numbers go
 *                  as Dash's comment on the post_to step or raise, and one
 *                  line comes back into this chat.
 *
 * Owner-only and Dev workspace on, in Ask Dash, row threads and the People
 * bots (PEOPLE_TOOLS is Ask's list); never on the connector, which has no
 * chat to text back into. What it asked is recorded on Home, with no Undo: a
 * route that has run cannot be called back.
 */

class Refused extends Error {}

type Args = Record<string, unknown>;

/** Where the finish line is said: an Ask Dash conversation, a People thread, or nowhere. */
export type AppRouteReplyTo = { conversationId: string } | { advisorChatId: string; advisorId: string } | null;

/** A poll as the tool keeps it. */
export type NewAppRoutePoll = {
  userId: string;
  askedBy: string;
  path: string;
  query: AppRouteQuery;
  thenQuery: AppRouteQuery;
  pollUntil: string;
  everySeconds: number;
  /** ISO time after which no call is made. */
  deadline: string;
  /** ISO time of the next call. */
  nextAt: string;
  calls: number;
  lastRunId: string | null;
  result: unknown;
  postToRef: string | null;
  postToLabel: string | null;
  replyTo: AppRouteReplyTo;
};

/**
 * What run_app_route needs from where it is asked (lib/dash/app-route-port.ts
 * binds it to a request; tests hand in fakes).
 */
export type DashAppRoutePort = {
  /** Whether the person asking is the account that owns the app. */
  isOwner: boolean;
  /** Who asked, for the run log: `dash`, or `bot:<name>` on People. */
  askedBy: string;
  replyTo: AppRouteReplyTo;
  /** One call through the runner. */
  run(input: { path: string; query: AppRouteQuery; askedBy: string }): Promise<AppRouteResult>;
  /** Keeps the background poll; returns its id. */
  keepPoll(poll: NewAppRoutePoll): Promise<string>;
  /** Dash's comment on a plan step or raise, by its `public.<table>:<id>` ref. */
  comment(input: { userId: string; ref: string; body: string }): Promise<void>;
};

export const RUN_APP_ROUTE = 'run_app_route' satisfies PostChangeKind;

export const MIN_EVERY_SECONDS = 30;
export const MAX_EVERY_SECONDS = 3600;
export const MAX_POLL_MINUTES = 120;
/** The most of a route's JSON the model is handed back. */
export const RESULT_FOR_MODEL_CHARS = 4000;

const FIELD = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;
const OUTLINE = /^#?\d+(?:\.\d+)*$/;
const RAISE = /^(?:raise\s+)?([0-9a-f]{6,8}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

const NO_UNDO = 'A route that has run cannot be called back.';

function queryOf(value: unknown, name: string): AppRouteQuery {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Refused(`${name} must be an object of names and values, such as {"start": 1}.`);
  return value as AppRouteQuery;
}

function whole(value: unknown, name: string, fallback: number, min: number, max: number): number {
  if (value === undefined || value === null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Refused(`${name} must be a number from ${min} to ${max}.`);
  return Math.round(n);
}

type PostTo = { ref: string; label: string; href: string };

/** The step or raise post_to names, as the person's own row, or a refusal. */
export async function resolvePostTo(ctx: Pick<DashWriteContext, 'db' | 'userId'>, raw: unknown): Promise<PostTo | null> {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw new Refused('post_to is a step outline such as "#2789" or a raise id such as "e7f5413a".');
  const text = raw.trim();
  const db = await ctx.db('public');

  if (OUTLINE.test(text)) {
    const outline = text.replace(/^#/, '');
    const numbered = outline.includes('.')
      ? await db.from('plan_item_outlines').select('number').eq('user_id', ctx.userId).eq('outline', outline).maybeSingle()
      : { data: { number: Number(outline) }, error: null };
    if (numbered.error) throw new Error(`plan_item_outlines: ${numbered.error.message}`);
    const number = (numbered.data as { number?: unknown } | null)?.number;
    if (typeof number !== 'number') throw new Refused(`#${outline} names no step on the plan.`);
    const { data, error } = await db.from('plan_items').select('id, number').eq('user_id', ctx.userId).eq('number', number).maybeSingle();
    if (error) throw new Error(`plan_items: ${error.message}`);
    const step = data as { id: string; number: number } | null;
    if (!step) throw new Refused(`#${outline} names no step on the plan.`);
    return { ref: toRef('public.plan_items', step.id), label: `#${outline}`, href: planHref(step.number) };
  }

  const raise = text.match(RAISE)?.[1]?.toLowerCase();
  if (raise) {
    const { data, error } = await db.from('raised_items').select('id').eq('user_id', ctx.userId).order('created_at', { ascending: false }).limit(2000);
    if (error) throw new Error(`raised_items: ${error.message}`);
    const found = ((data ?? []) as { id: string }[]).filter((row) => row.id.toLowerCase().startsWith(raise));
    if (found.length === 0) throw new Refused(`No raise has the id ${raise}.`);
    if (found.length > 1) throw new Refused(`More than one raise starts ${raise}; give more of its id.`);
    const id = found[0].id;
    return { ref: toRef('public.raised_items', id), label: `raise ${id.slice(0, 8)}`, href: `/dev/inbox#${raiseAnchor(id)}` };
  }
  throw new Refused(`post_to "${text.slice(0, 60)}" is neither a step outline such as "#2789" nor a raise id such as "e7f5413a".`);
}

function resultText(result: unknown): string {
  let text: string;
  try {
    text = typeof result === 'string' ? result : (JSON.stringify(result) ?? 'null');
  } catch {
    text = String(result);
  }
  return text.length > RESULT_FOR_MODEL_CHARS ? `${text.slice(0, RESULT_FOR_MODEL_CHARS)}… (cut)` : text;
}

async function runRoute(ctx: DashWriteContext, args: Args): Promise<DashWriteResult> {
  if (!ctx.enabledModules.includes('dev')) throw new Refused('The Dev workspace is switched off, so no route was run.');
  if (!ctx.appRoute) throw new Refused('No route can be run from here.');
  const port = await ctx.appRoute();
  if (!port.isOwner) throw new Refused('No route was run: only the account that owns this app can run its routes.');

  const path = typeof args.path === 'string' ? args.path.trim() : '';
  if (!path) throw new Refused('path is missing: give the route, such as /api/cron/broker-wake-test.');
  const query = queryOf(args.query, 'query');
  const pollUntil = typeof args.poll_until === 'string' ? args.poll_until.trim() : '';
  if (pollUntil && !FIELD.test(pollUntil)) throw new Refused('poll_until is the name of a field in the route\'s JSON, such as "finished".');
  const thenQuery = args.then_query === undefined ? query : queryOf(args.then_query, 'then_query');
  const everySeconds = whole(args.poll_every_seconds, 'poll_every_seconds', POLL_EVERY_SECONDS, MIN_EVERY_SECONDS, MAX_EVERY_SECONDS);
  const maxMinutes = whole(args.max_minutes, 'max_minutes', POLL_MAX_MINUTES, 1, MAX_POLL_MINUTES);
  const postTo = await resolvePostTo(ctx, args.post_to);

  const started = new Date(ctx.now ?? Date.now());
  const first = await port.run({ path, query, askedBy: port.askedBy });
  if (first.outcome === 'refused') throw new Refused(`The route was not run: ${first.error ?? 'it was refused.'}`);

  const polling = Boolean(pollUntil) && first.outcome === 'ok' && !fieldIsTrue(first.result, pollUntil);
  const numbers = numbersLine(first.result);
  const href = postTo?.href ?? '/dev';
  let pollId: string | null = null;
  let posted = false;

  if (polling) {
    pollId = await port.keepPoll({
      userId: ctx.userId,
      askedBy: port.askedBy,
      path,
      query,
      thenQuery,
      pollUntil,
      everySeconds,
      deadline: new Date(started.getTime() + maxMinutes * 60_000).toISOString(),
      nextAt: new Date(started.getTime() + everySeconds * 1000).toISOString(),
      calls: 1,
      lastRunId: first.runId,
      result: first.result,
      postToRef: postTo?.ref ?? null,
      postToLabel: postTo?.label ?? null,
      replyTo: port.replyTo,
    });
  } else if (postTo) {
    // Finished in the one call: the comment goes now, and the reply is the chat line.
    const poll: AppRoutePoll = {
      id: '',
      userId: ctx.userId,
      askedBy: port.askedBy,
      path,
      thenQuery,
      pollUntil: pollUntil || '(none)',
      everySeconds,
      deadline: started.toISOString(),
      createdAt: started.toISOString(),
      calls: 1,
      postToRef: postTo.ref,
      postToLabel: postTo.label,
    };
    const finish: PollFinish = {
      id: '',
      status: first.outcome === 'ok' ? 'done' : 'failed',
      calls: 1,
      lastRunId: first.runId,
      result: first.result,
      error: first.error,
    };
    try {
      await port.comment({ userId: ctx.userId, ref: postTo.ref, body: finishComment(poll, finish, started) });
      posted = true;
    } catch (error) {
      console.error('the run_app_route comment was not written', error instanceof Error ? error.message : error);
    }
  }

  const how =
    first.outcome === 'failed'
      ? `It did not succeed${first.httpStatus ? ` (HTTP ${first.httpStatus})` : ''}: ${first.error ?? 'no reason came back'}.`
      : polling
        ? `${pollUntil} is not true yet, so Dash calls it again every ${everySeconds} seconds for up to ${maxMinutes} minutes, and says here when it ends${postTo ? `, with the full result on ${postTo.label}` : ''}.`
        : pollUntil
          ? `${pollUntil} is already true.`
          : 'It answered.';
  const summary =
    `Dash ran GET ${path}. ${how}` +
    (numbers && !polling ? ` Numbers: ${numbers}.` : '') +
    (postTo && !polling ? (posted ? ` The result is on ${postTo.label}.` : ` It could not be put on ${postTo.label}.`) : '');

  const subjectRef = pollId ? toRef('public.app_route_polls', pollId) : toRef('public.app_route_runs', first.runId ?? '');
  const input: PostChangeInput = {
    verb: polling ? 'Started polling' : 'Ran',
    what: `GET ${path}`,
    rest: polling ? ` until ${pollUntil} is true` : '',
    href,
    where: postTo ? `Open ${postTo.label}` : 'Open Dev',
    paths: [href],
  };
  return {
    ok: true,
    kind: RUN_APP_ROUTE,
    input: input as unknown as Record<string, unknown>,
    subjectRef,
    op: 'insert',
    before: null,
    after: { path, query, outcome: first.outcome, http_status: first.httpStatus, poll_until: pollUntil || null, polling },
    summary,
    undo: { none: NO_UNDO },
    row: {
      table: pollId ? 'public.app_route_polls' : 'public.app_route_runs',
      ref: pollId ?? first.runId ?? '',
      title: `GET ${path}`,
      href,
      detail: {
        outcome: first.outcome,
        http_status: first.httpStatus,
        polling,
        numbers: numbers || null,
        result: resultText(first.result),
      },
    },
  };
}

function guarded(run: (ctx: DashWriteContext, args: Args) => Promise<DashWriteResult>) {
  return async (ctx: DashWriteContext, input: unknown): Promise<DashWriteResult> => {
    const args = input && typeof input === 'object' ? (input as Args) : {};
    try {
      return await run(ctx, args);
    } catch (error) {
      if (error instanceof Refused) return { ok: false, error: error.message };
      console.error('dash write run_app_route failed', error instanceof Error ? error.message : error);
      return { ok: false, error: 'The route could not be run. Tell them nothing was started.' };
    }
  };
}

const QUERY_SCHEMA = {
  type: 'object',
  additionalProperties: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] },
} as const;

const INPUT: Anthropic.Tool['input_schema'] = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'The route, as /api/cron/<name>, such as /api/cron/broker-wake-test. No host and no ? query.' },
    query: { ...QUERY_SCHEMA, description: 'The first call\'s query, such as {"start": 1}.' },
    then_query: {
      ...QUERY_SCHEMA,
      description: 'The query for the polling calls after the first; the same as query when left out. Pass {} when the first call starts something and the rest only check on it.',
    },
    poll_until: { type: 'string', description: 'A field of the route\'s JSON, such as "finished": keep calling until it is true.' },
    poll_every_seconds: { type: 'number', description: `Seconds between polling calls, ${MIN_EVERY_SECONDS} to ${MAX_EVERY_SECONDS}; ${POLL_EVERY_SECONDS} when left out.` },
    max_minutes: { type: 'number', description: `How long to keep polling, 1 to ${MAX_POLL_MINUTES} minutes; ${POLL_MAX_MINUTES} when left out.` },
    post_to: { type: 'string', description: 'A plan step outline ("#2789") or a raise id ("e7f5413a") to put the final result on as a comment.' },
  },
  required: ['path'],
  additionalProperties: false,
};

/** The app-route write tool. */
export const APP_ROUTE_WRITE_TOOLS: readonly DashWriteTool<DashWriteResult>[] = [
  {
    name: RUN_APP_ROUTE,
    kind: 'write',
    inAppOnly: true,
    runs: noButton('No page has a button for a cron route; the scheduler and sessions call them, and this runs one from a chat.'),
    definition: {
      name: RUN_APP_ROUTE,
      description:
        'Run one of the app\'s own cron routes, GET /api/cron/<name>, when they ask ("run the broker wake test"). The server attaches the secret; you never see it and never ask for it. ' +
        'With poll_until, it keeps calling the route in the background, every poll_every_seconds for up to max_minutes, until that field of its JSON is true; this turn ends straight away, and when it ends the result is said in this chat and, with post_to, put as a comment on that plan step or raise. ' +
        'For a route that starts something on its first call, pass the start in query and then_query {} for the checks after it. ' +
        'Refused for anyone but the account that owns the app, with the Dev workspace off, and for any path off /api/cron/. The request is the go-ahead: call it without asking them to confirm. ' +
        'Say what the result says: the numbers it returned, or that it is polling and will report back here.',
      input_schema: INPUT,
    },
    apply: guarded(runRoute),
  },
];
