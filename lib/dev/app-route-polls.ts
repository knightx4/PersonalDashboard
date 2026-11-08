/**
 * Polling one of the app's own routes in the background, for run_app_route
 * (plan #3070.3, under #3070; lib/dash/app-route-writes.ts).
 *
 * The tool calls the route once in the chat turn. When it was given a field
 * to wait on and the field is not yet true, it keeps an app_route_polls row
 * (migration 0316) and returns. Every minute pg_cron calls
 * /api/cron/app-route-polls, which runs `runAppRoutePolls`: each due row has
 * its route called once more through runAppRoute (so the secret stays on the
 * server and every call is a row in app_route_runs), and then either
 *
 *   - finishes `done`, when the field came back true;
 *   - finishes `failed`, when the call was refused or did not succeed;
 *   - finishes `timed_out`, when the next call would fall past its deadline;
 *   - or is put off until its next call.
 *
 * A call refused because three runs are already going is not a failure: the
 * row is tried again on the next pass.
 *
 * On a finish the final JSON and a line of its numbers go as Dash's comment
 * on the plan step or raise the row names (`post_to_ref`), and one line goes
 * into the chat it was asked from. Kept free of Supabase so it is tested with
 * fakes; the adapters are in lib/dev/app-route-polls-store.ts.
 */

import { fieldIsTrue, runAppRoute, type AppRouteQuery, type AppRouteResult } from './app-route';

/** Polls taken in one pass: the runner's own limit on runs at once. */
export const POLLS_PER_PASS = 3;

/** How long a pass holds the rows it took: longer than one call may take. */
export const POLL_LEASE_SECONDS = 360;

/** When a call is refused for the concurrency limit, how soon it is tried again. */
export const BUSY_RETRY_SECONDS = 60;

/** The most of the final JSON a comment carries. */
export const COMMENT_JSON_CHARS = 6000;

/** The most numbers the summary line names. */
export const SUMMARY_NUMBERS = 10;

export type PollStatus = 'polling' | 'done' | 'timed_out' | 'failed';

/** A poll as a pass reads it. */
export type AppRoutePoll = {
  id: string;
  userId: string;
  askedBy: string;
  path: string;
  thenQuery: AppRouteQuery;
  pollUntil: string;
  everySeconds: number;
  deadline: string;
  createdAt: string;
  calls: number;
  /** `public.plan_items:<id>` or `public.raised_items:<id>`; null when nothing is commented on. */
  postToRef: string | null;
  /** `#2789` or `raise e7f5413a`, for the chat line. */
  postToLabel: string | null;
};

export type PollFinish = {
  id: string;
  status: Exclude<PollStatus, 'polling'>;
  calls: number;
  lastRunId: string | null;
  result: unknown;
  error: string | null;
};

export type AppRoutePollPorts = {
  /** The owner's due polls, leased for this pass. */
  claim(limit: number, leaseSeconds: number): Promise<AppRoutePoll[]>;
  /** One call of the route, through the runner. */
  run(input: { path: string; query: AppRouteQuery; askedBy: string }): Promise<AppRouteResult>;
  /** Puts the next call off until `nextAt` and releases the lease. */
  putOff(input: { id: string; calls: number; lastRunId: string | null; result: unknown; nextAt: string }): Promise<void>;
  /** Closes the row. */
  finish(input: PollFinish): Promise<void>;
  /** Dash's comment on the plan step or raise. */
  comment(input: { userId: string; ref: string; body: string }): Promise<void>;
  /** The line in the chat the poll came from; nothing when there is no chat. */
  say(input: { id: string; text: string }): Promise<void>;
};

export type PollOutcome = { id: string; kind: 'put_off' | 'busy' | PollFinish['status']; posted: boolean; said: boolean };

export type PollPassSummary = { polls: number; outcomes: PollOutcome[]; failed: string[] };

/** Every number (and true/false) in a result, with its dotted name, two levels deep. */
export function numbersOf(result: unknown, limit = SUMMARY_NUMBERS): [string, number | boolean][] {
  const out: [string, number | boolean][] = [];
  const walk = (value: unknown, prefix: string, depth: number) => {
    if (out.length >= limit || value === null || typeof value !== 'object' || Array.isArray(value)) return;
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (out.length >= limit) return;
      const name = prefix ? `${prefix}.${key}` : key;
      if ((typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean') out.push([name, v]);
      else if (depth < 2) walk(v, name, depth + 1);
    }
  };
  walk(result, '', 1);
  return out;
}

/** `delivered 3, waited_seconds 410, finished true`; empty when the result holds no numbers. */
export function numbersLine(result: unknown): string {
  return numbersOf(result)
    .map(([name, value]) => `${name} ${value}`)
    .join(', ');
}

function minutesBetween(from: string, to: Date): number {
  const ms = to.getTime() - new Date(from).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 60_000)) : 0;
}

const ENDED: Record<PollFinish['status'], string> = {
  done: 'finished',
  timed_out: 'ran out of time',
  failed: 'stopped on a call that did not succeed',
};

/** The headline both the comment and the chat line open with. */
export function finishHeadline(poll: Pick<AppRoutePoll, 'path' | 'pollUntil' | 'createdAt'>, finish: PollFinish, now: Date): string {
  const minutes = minutesBetween(poll.createdAt, now);
  const calls = `${finish.calls} call${finish.calls === 1 ? '' : 's'} over ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const field = finish.status === 'done' ? `: ${poll.pollUntil} is true` : finish.status === 'timed_out' ? ` before ${poll.pollUntil} was true` : '';
  return `GET ${poll.path} ${ENDED[finish.status]}${field}, after ${calls}.`;
}

/** The comment on the step or raise: the headline, the numbers, any error, and the final JSON. */
export function finishComment(poll: AppRoutePoll, finish: PollFinish, now: Date): string {
  const numbers = numbersLine(finish.result);
  let json = '';
  try {
    json = JSON.stringify(finish.result ?? null, null, 2) ?? 'null';
  } catch {
    json = String(finish.result);
  }
  if (json.length > COMMENT_JSON_CHARS) json = `${json.slice(0, COMMENT_JSON_CHARS)}\n… (cut at ${COMMENT_JSON_CHARS} characters)`;
  return [
    `Dash ran ${finishHeadline(poll, finish, now)}`,
    numbers ? `Numbers: ${numbers}.` : null,
    finish.error ? `Error: ${finish.error}` : null,
    `Final JSON:\n\`\`\`json\n${json}\n\`\`\``,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The one line into the chat. */
export function finishLine(poll: AppRoutePoll, finish: PollFinish, now: Date, posted: boolean): string {
  const numbers = numbersLine(finish.result);
  const where = poll.postToLabel ? (posted ? ` The full result is on ${poll.postToLabel}.` : ` It could not be put on ${poll.postToLabel}.`) : '';
  return [finishHeadline(poll, finish, now), numbers ? `${numbers}.` : '', finish.error ? `${finish.error}` : '', where.trim()]
    .filter(Boolean)
    .join(' ');
}

/** What becomes of a poll after one call. */
export function nextFor(
  poll: AppRoutePoll,
  last: AppRouteResult,
  now: Date,
): { kind: 'busy' } | { kind: 'put_off'; nextAt: string } | { kind: 'finish'; status: PollFinish['status'] } {
  // The runner's concurrency refusal keeps no run of its own: try again soon.
  if (last.outcome === 'refused' && last.runId === null) return { kind: 'busy' };
  if (last.outcome !== 'ok') return { kind: 'finish', status: 'failed' };
  if (fieldIsTrue(last.result, poll.pollUntil)) return { kind: 'finish', status: 'done' };
  const next = now.getTime() + poll.everySeconds * 1000;
  if (next > new Date(poll.deadline).getTime()) return { kind: 'finish', status: 'timed_out' };
  return { kind: 'put_off', nextAt: new Date(next).toISOString() };
}

/**
 * Posts a finish: the comment on the step or raise, then the chat line. Each
 * is tried on its own, so a comment that fails still leaves the chat told.
 */
export async function postFinish(
  ports: Pick<AppRoutePollPorts, 'comment' | 'say'>,
  poll: AppRoutePoll,
  finish: PollFinish,
  now: Date,
): Promise<{ posted: boolean; said: boolean }> {
  let posted = false;
  if (poll.postToRef) {
    try {
      await ports.comment({ userId: poll.userId, ref: poll.postToRef, body: finishComment(poll, finish, now) });
      posted = true;
    } catch (error) {
      console.error('the app route poll comment was not written', error instanceof Error ? error.message : error);
    }
  }
  let said = false;
  try {
    await ports.say({ id: poll.id, text: finishLine(poll, finish, now, posted) });
    said = true;
  } catch (error) {
    console.error('the app route poll line was not said', error instanceof Error ? error.message : error);
  }
  return { posted, said };
}

/** One pass: each due poll called once, then put off or finished. */
export async function runAppRoutePolls(ports: AppRoutePollPorts, now: () => Date = () => new Date()): Promise<PollPassSummary> {
  const polls = await ports.claim(POLLS_PER_PASS, POLL_LEASE_SECONDS);
  const summary: PollPassSummary = { polls: polls.length, outcomes: [], failed: [] };

  await Promise.all(
    polls.map(async (poll) => {
      try {
        const last = await ports.run({ path: poll.path, query: poll.thenQuery, askedBy: poll.askedBy });
        const at = now();
        const next = nextFor(poll, last, at);
        if (next.kind === 'busy') {
          await ports.putOff({
            id: poll.id,
            calls: poll.calls,
            lastRunId: null,
            result: undefined,
            nextAt: new Date(at.getTime() + BUSY_RETRY_SECONDS * 1000).toISOString(),
          });
          summary.outcomes.push({ id: poll.id, kind: 'busy', posted: false, said: false });
          return;
        }
        const calls = poll.calls + 1;
        if (next.kind === 'put_off') {
          await ports.putOff({ id: poll.id, calls, lastRunId: last.runId, result: last.result, nextAt: next.nextAt });
          summary.outcomes.push({ id: poll.id, kind: 'put_off', posted: false, said: false });
          return;
        }
        const finish: PollFinish = { id: poll.id, status: next.status, calls, lastRunId: last.runId, result: last.result, error: last.error };
        await ports.finish(finish);
        const { posted, said } = await postFinish(ports, poll, finish, at);
        summary.outcomes.push({ id: poll.id, kind: next.status, posted, said });
      } catch (error) {
        console.error('an app route poll failed', error instanceof Error ? error.message : error);
        summary.failed.push(poll.id);
      }
    }),
  );
  return summary;
}

/** The runner as the pass calls it. */
export function runOnce(input: { path: string; query: AppRouteQuery; askedBy: string }): Promise<AppRouteResult> {
  return runAppRoute(input);
}
