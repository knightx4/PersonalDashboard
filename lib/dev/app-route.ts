/**
 * Run one of the app's own routes on someone's behalf (plan #3070.1, under
 * #3070).
 *
 * Sessions, Dash and the People bots cannot hold CRON_SECRET, and should not:
 * a secret a model has seen can end up in a prompt, a reply or a log. So they
 * ask the server, and runAppRoute calls GET on the app's own domain with the
 * secret attached here and nowhere else. The secret is never returned, never
 * logged and never put in an error: anything that comes back is searched for
 * it and has it replaced before it is stored or returned.
 *
 * Only the app's own routes are run: GET /api/cron/<name>, plus the paths in
 * EXTRA_APP_ROUTES. Any other path, a path that names a host, and an origin
 * other than the app's own domain are refused. At most APP_ROUTE_CONCURRENCY
 * runs go at once (counted in the database, so across functions), and every
 * run, refused ones too, is a row in public.app_route_runs (migration 0315).
 *
 * pollAppRoute calls a route again every few seconds until a field of its JSON
 * is true or the time runs out, for a route such as
 * /api/cron/broker-wake-test that does one step per call.
 */

/** Runs allowed at once; a fourth is refused. */
export const APP_ROUTE_CONCURRENCY = 3;

/** A run still marked running after this long is taken to have died. */
export const APP_ROUTE_STALE_MINUTES = 15;

/** How long one call may take before it is given up on. */
export const APP_ROUTE_TIMEOUT_MS = 300_000;

/** The most of a body kept on the run's row and returned. */
export const APP_ROUTE_RESULT_CHARS = 100_000;

/**
 * Routes outside /api/cron/ that may be run, by exact path. Add one only for
 * an internal route that is authorised with CRON_SECRET the way the cron
 * routes are.
 */
export const EXTRA_APP_ROUTES: readonly string[] = [];

const CRON_PATH = /^\/api\/cron\/[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/;
const QUERY_KEY = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_QUERY_VALUE = 500;
const MAX_QUERY_KEYS = 20;

export type AppRouteQuery = Record<string, string | number | boolean>;

export type AppRouteOutcome = 'ok' | 'failed' | 'refused';

export type AppRouteResult = {
  /** The run's row in public.app_route_runs; null only when it could not be written. */
  runId: string | null;
  outcome: AppRouteOutcome;
  /** The route's HTTP status; null when it was never reached. */
  httpStatus: number | null;
  /** The body: parsed JSON, or the text as a string. Null when there was none. */
  result: unknown;
  /** Bytes in the body as it came back, before any cut. */
  resultBytes: number | null;
  /** Why it was refused or failed, with no secret in it. */
  error: string | null;
};

/** Where runs are recorded. The default writes public.app_route_runs. */
export type AppRouteStore = {
  /** Open a running row, or log it refused and return null when the limit is reached. */
  start(input: { askedBy: string; path: string; query: AppRouteQuery; limit: number; staleMinutes: number }): Promise<string | null>;
  finish(input: {
    id: string;
    status: 'ok' | 'failed';
    httpStatus: number | null;
    result: unknown;
    resultBytes: number | null;
    error: string | null;
  }): Promise<void>;
  refuse(input: { askedBy: string; path: string; query: AppRouteQuery; error: string }): Promise<string | null>;
};

export type AppRouteDeps = {
  store: AppRouteStore;
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  timeoutMs?: number;
};

export type RunAppRouteInput = {
  path: string;
  query?: AppRouteQuery;
  /** Who asked, for the log: `session:<id>`, `dash`, `bot:<name>`. */
  askedBy: string;
};

/** Why a path may not be run, or null when it may. */
export function refuseAppRoutePath(path: string): string | null {
  if (typeof path !== 'string' || path.length === 0) return 'No path was given.';
  if (!path.startsWith('/') || path.startsWith('//')) return 'Only a path on the app itself can be run, such as /api/cron/<name>.';
  if (path.includes('?') || path.includes('#')) return 'Put the query in `query`, not in the path.';
  if (EXTRA_APP_ROUTES.includes(path)) return null;
  if (CRON_PATH.test(path)) return null;
  return `${path.slice(0, 200)} is not on the list of routes that can be run: GET /api/cron/<name>${
    EXTRA_APP_ROUTES.length ? ` or ${EXTRA_APP_ROUTES.join(', ')}` : ''
  }.`;
}

/** Why a query may not be sent, or null when it may. */
export function refuseAppRouteQuery(query: AppRouteQuery): string | null {
  if (query === null || typeof query !== 'object' || Array.isArray(query)) return 'The query must be an object of names and values.';
  const keys = Object.keys(query);
  if (keys.length > MAX_QUERY_KEYS) return `A query takes at most ${MAX_QUERY_KEYS} values.`;
  for (const key of keys) {
    if (!QUERY_KEY.test(key)) return `${key.slice(0, 64)} is not a query name that can be sent.`;
    const value = query[key];
    if (!['string', 'number', 'boolean'].includes(typeof value)) return `The value of ${key} must be text, a number or true/false.`;
    if (String(value).length > MAX_QUERY_VALUE) return `The value of ${key} is longer than ${MAX_QUERY_VALUE} characters.`;
  }
  return null;
}

/**
 * The app's own origin: the production custom domain when Vercel names one,
 * else NEXT_PUBLIC_APP_URL. A *.vercel.app host is never used, because
 * Vercel's login protection refuses a call to it before the app sees it
 * (inngest/cron/authorize.ts, requestOrigin). Null when neither is set.
 */
export function appRouteOrigin(env: Record<string, string | undefined>): string | null {
  const production = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (production && !production.endsWith('.vercel.app')) {
    try {
      return new URL(`https://${production.replace(/^https?:\/\//, '')}`).origin;
    } catch {
      // fall through to the configured address
    }
  }
  const configured = env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (url.hostname.endsWith('.vercel.app')) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Every occurrence of the secret in a string, replaced. */
export function redactSecret(text: string, secret: string): string {
  return secret ? text.split(secret).join('[redacted]') : text;
}

function redactDeep(value: unknown, secret: string): unknown {
  if (typeof value === 'string') return redactSecret(value, secret);
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, secret));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [redactSecret(k, secret), redactDeep(v, secret)]),
    );
  }
  return value;
}

/** The body as stored: JSON when it parses and fits, else the text cut to size. */
function readBody(text: string, secret: string): unknown {
  const clean = redactSecret(text, secret);
  if (clean.length === 0) return null;
  if (clean.length <= APP_ROUTE_RESULT_CHARS) {
    try {
      return JSON.parse(clean);
    } catch {
      return clean;
    }
  }
  return clean.slice(0, APP_ROUTE_RESULT_CHARS);
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'The route did not answer in time.';
    return error.message || error.name;
  }
  return String(error);
}

/**
 * The server's own store, fetch and environment for what the caller left
 * out. The store is imported only when needed, so tests that pass their own
 * never load the service-role client.
 */
async function withDefaults(given: Partial<AppRouteDeps>): Promise<AppRouteDeps> {
  const store = given.store ?? (await import('@/lib/dev/app-route-store')).appRouteRunStore();
  return { store, fetch: given.fetch ?? fetch, env: given.env ?? process.env, timeoutMs: given.timeoutMs };
}

/**
 * Call one allowlisted route with CRON_SECRET attached, and log the run.
 * Never throws for a refusal or a failed call: the outcome says which. It
 * throws only when the log itself cannot be written, with no secret in the
 * message.
 */
export async function runAppRoute(input: RunAppRouteInput, given: Partial<AppRouteDeps> = {}): Promise<AppRouteResult> {
  const deps = await withDefaults(given);
  const { store, env } = deps;
  const askedBy = (input.askedBy ?? '').trim().slice(0, 200) || 'unknown';
  const path = typeof input.path === 'string' ? input.path.trim() : '';
  const query: AppRouteQuery = input.query ?? {};

  const refused = async (error: string): Promise<AppRouteResult> => {
    const runId = await store.refuse({ askedBy, path: path.slice(0, 500) || '(none)', query: refuseAppRouteQuery(query) ? {} : query, error });
    return { runId, outcome: 'refused', httpStatus: null, result: null, resultBytes: null, error };
  };

  const pathRefusal = refuseAppRoutePath(path);
  if (pathRefusal) return refused(pathRefusal);
  const queryRefusal = refuseAppRouteQuery(query);
  if (queryRefusal) return refused(queryRefusal);

  const origin = appRouteOrigin(env);
  if (!origin) return refused("The app's own domain is not set on the server (VERCEL_PROJECT_PRODUCTION_URL or NEXT_PUBLIC_APP_URL).");
  const secret = env.CRON_SECRET?.trim() ?? '';
  if (!secret) return refused('CRON_SECRET is not set on the server, so the route cannot be run.');

  const url = new URL(path, origin);
  // A path cannot move the call off the app's own host, but check what is sent.
  if (url.origin !== origin) return refused('Only the app itself can be called.');
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));

  const runId = await store.start({
    askedBy,
    path,
    query,
    limit: APP_ROUTE_CONCURRENCY,
    staleMinutes: APP_ROUTE_STALE_MINUTES,
  });
  if (!runId) {
    return {
      runId: null,
      outcome: 'refused',
      httpStatus: null,
      result: null,
      resultBytes: null,
      error: `${APP_ROUTE_CONCURRENCY} runs are already going; try again when one has finished.`,
    };
  }

  let httpStatus: number | null = null;
  let result: unknown = null;
  let resultBytes: number | null = null;
  let error: string | null = null;
  try {
    const res = await deps.fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' },
      // A redirect would carry the call somewhere else; it is a failure instead.
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(deps.timeoutMs ?? APP_ROUTE_TIMEOUT_MS),
    });
    httpStatus = res.status;
    const text = await res.text();
    resultBytes = new TextEncoder().encode(text).length;
    result = readBody(text, secret);
    if (res.status >= 300) {
      error = res.status >= 300 && res.status < 400 ? `The route redirected (${res.status}); it was not followed.` : `The route answered ${res.status}.`;
    }
  } catch (err) {
    error = messageOf(err);
  }
  error = error === null ? null : redactSecret(error, secret);
  result = redactDeep(result, secret);
  const outcome: 'ok' | 'failed' = error === null ? 'ok' : 'failed';

  await store.finish({ id: runId, status: outcome, httpStatus, result, resultBytes, error });
  return { runId, outcome, httpStatus, result, resultBytes, error };
}

/** The value at a dotted field path of a result, such as `finished` or `report.finished`. */
export function fieldOf(result: unknown, field: string): unknown {
  let value: unknown = result;
  for (const part of field.split('.')) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

/** Whether that field of the result is exactly true. */
export function fieldIsTrue(result: unknown, field: string): boolean {
  return fieldOf(result, field) === true;
}

export type PollAppRouteInput = RunAppRouteInput & {
  /** The JSON field that says the route is done, such as `finished`. */
  untilField: string;
  /** The query for the calls after the first; the first call's query when absent. */
  thenQuery?: AppRouteQuery;
  everySeconds?: number;
  maxMinutes?: number;
};

export type PollAppRouteResult = {
  /** True when the field came back true; false when time ran out or a call did not succeed. */
  done: boolean;
  /** The last call's result. */
  last: AppRouteResult;
  calls: number;
};

export type PollDeps = Partial<AppRouteDeps> & {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export const POLL_EVERY_SECONDS = 90;
export const POLL_MAX_MINUTES = 30;

/**
 * Call a route, then call it again every `everySeconds` until `untilField` in
 * its JSON is true or `maxMinutes` have passed. Stops at the first call that
 * does not come back ok. Each call is its own run on the log. This waits in
 * the process that calls it, so a run longer than one request belongs on a
 * schedule that calls runAppRoute once per tick and reads fieldIsTrue.
 */
export async function pollAppRoute(input: PollAppRouteInput, given: PollDeps = {}): Promise<PollAppRouteResult> {
  const deps = await withDefaults(given);
  const sleep = given.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = given.now ?? Date.now;
  const everyMs = Math.max(5, input.everySeconds ?? POLL_EVERY_SECONDS) * 1000;
  const deadline = now() + Math.max(1, input.maxMinutes ?? POLL_MAX_MINUTES) * 60_000;

  let calls = 0;
  let last = await runAppRoute(input, deps);
  calls += 1;
  while (last.outcome === 'ok' && !fieldIsTrue(last.result, input.untilField)) {
    if (now() + everyMs > deadline) break;
    await sleep(everyMs);
    last = await runAppRoute({ ...input, query: input.thenQuery ?? input.query }, deps);
    calls += 1;
  }
  return { done: last.outcome === 'ok' && fieldIsTrue(last.result, input.untilField), last, calls };
}
