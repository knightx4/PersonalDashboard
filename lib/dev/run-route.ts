import { timingSafeEqual } from 'node:crypto';
import {
  fieldOf,
  pollAppRoute,
  runAppRoute,
  type AppRouteDeps,
  type AppRouteQuery,
  type AppRouteResult,
} from '@/lib/dev/app-route';

/**
 * The endpoint behind `plan.ts run-route` (plan #3070.2, under #3070).
 *
 * A Claude Code session cannot hold CRON_SECRET, so it asks the server to run
 * one of the app's own cron routes. The credential it presents is the one it
 * already uses to write to the plan: the service-role key, as
 * `Authorization: Bearer <key>`. Everything after that is lib/dev/app-route.ts,
 * which attaches CRON_SECRET on the server, refuses any path off the
 * allowlist and returns the JSON with the secret taken out.
 */

/** One request may wait this long; the route sets maxDuration to match. */
export const RUN_ROUTE_MAX_DURATION_SECONDS = 300;
/** One call inside a request is given up on after this long. */
export const RUN_ROUTE_CALL_TIMEOUT_MS = 120_000;
/** Polling inside one request stops after this many minutes. */
export const RUN_ROUTE_POLL_MAX_MINUTES = 3;

/** Whether the header carries the service-role key. Constant-time; false when no key is set. */
export function isSessionAuthorised(
  authorization: string | null,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) return false;
  const given = (authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type RunRouteResponse = { status: number; body: Record<string, unknown> };

function askedByOf(value: unknown): string {
  return typeof value === 'string' && /^session:[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : 'session:unknown';
}

function numberIn(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : undefined;
}

function toBody(r: AppRouteResult): Record<string, unknown> {
  return {
    runId: r.runId,
    outcome: r.outcome,
    httpStatus: r.httpStatus,
    result: r.result,
    resultBytes: r.resultBytes,
    error: r.error,
  };
}

/** The HTTP status a run's outcome is answered with. */
function statusOf(r: AppRouteResult): number {
  if (r.outcome === 'ok') return 200;
  if (r.outcome === 'failed') return 502;
  return r.runId === null && /already going/.test(r.error ?? '') ? 429 : 400;
}

export async function handleRunRoute(
  input: { authorization: string | null; body: unknown },
  deps: Partial<AppRouteDeps> & { sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<RunRouteResponse> {
  if (!isSessionAuthorised(input.authorization, deps.env ?? process.env)) {
    return { status: 401, body: { error: 'unauthorized' } };
  }
  const body = input.body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { status: 400, body: { error: 'Send a JSON object with a path and an optional query.' } };
  }
  const req = body as Record<string, unknown>;
  if (typeof req.path !== 'string') return { status: 400, body: { error: 'A path is needed, such as /api/cron/<name>.' } };
  const query = (req.query ?? {}) as AppRouteQuery;
  const run = { path: req.path, query, askedBy: askedByOf(req.askedBy) };
  const given = { ...deps, timeoutMs: deps.timeoutMs ?? RUN_ROUTE_CALL_TIMEOUT_MS };

  const poll = req.poll && typeof req.poll === 'object' && !Array.isArray(req.poll) ? (req.poll as Record<string, unknown>) : null;
  if (poll && typeof poll.untilField === 'string' && poll.untilField) {
    const out = await pollAppRoute(
      {
        ...run,
        untilField: poll.untilField,
        thenQuery: poll.thenQuery && typeof poll.thenQuery === 'object' ? (poll.thenQuery as AppRouteQuery) : undefined,
        everySeconds: numberIn(poll.everySeconds, 5, 120),
        maxMinutes: numberIn(poll.maxMinutes, 1, RUN_ROUTE_POLL_MAX_MINUTES) ?? RUN_ROUTE_POLL_MAX_MINUTES,
      },
      given,
    );
    return {
      status: statusOf(out.last),
      body: { ...toBody(out.last), done: out.done, calls: out.calls, field: fieldOf(out.last.result, poll.untilField) ?? null },
    };
  }

  const out = await runAppRoute(run, given);
  return { status: statusOf(out), body: toBody(out) };
}
