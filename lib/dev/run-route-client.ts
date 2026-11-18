import { appRouteOrigin, fieldIsTrue, type AppRouteQuery } from '@/lib/dev/app-route';

/**
 * What `plan.ts run-route` does (plan #3070.2): ask the app's own endpoint
 * (app/api/dev/run-route) to run a cron route, with the service-role key a
 * session already holds. No CRON_SECRET is read or sent here.
 *
 * Polling is done here, one request per call, so it can run longer than one
 * request is allowed to (the endpoint's own poll is capped at a few minutes).
 */

export type RunRouteCliInput = {
  path: string;
  query?: AppRouteQuery;
  untilField?: string;
  thenQuery?: AppRouteQuery;
  everySeconds?: number;
  maxMinutes?: number;
  askedBy: string;
};

export type RunRouteCliDeps = {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
};

export type RunRouteCliOutput = { status: number; body: Record<string, unknown>; done: boolean | null; calls: number };

/** `a=1 b=x` pairs into a query; numbers and true/false keep their type. */
export function parseQueryPairs(pairs: string[]): AppRouteQuery {
  const query: AppRouteQuery = {};
  for (const pair of pairs) {
    const at = pair.indexOf('=');
    if (at < 1) throw new Error(`"${pair}" is not name=value.`);
    const value = pair.slice(at + 1);
    query[pair.slice(0, at)] = /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value === 'true' ? true : value === 'false' ? false : value;
  }
  return query;
}

/**
 * The query for the later polls from the command line (plan #3070.5). Absent
 * `--then` gives undefined (the first query repeats); `--then` with no
 * name=value after it (bare, or followed by another flag) gives an empty query.
 */
export function parseThenQuery(argv: string[]): AppRouteQuery | undefined {
  const pairs: string[] = [];
  let seen = false;
  argv.forEach((value, index) => {
    if (value !== '--then') return;
    seen = true;
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) pairs.push(next);
  });
  return seen ? parseQueryPairs(pairs) : undefined;
}

async function post(deps: RunRouteCliDeps, origin: string, key: string, payload: object) {
  const res = await deps.fetch(`${origin}/api/dev/run-route`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'manual',
  });
  const text = await res.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = { error: `The app answered ${res.status} with something that was not JSON.` };
  }
  return { status: res.status, body };
}

export async function runRouteFromCli(input: RunRouteCliInput, given: Partial<RunRouteCliDeps> = {}): Promise<RunRouteCliOutput> {
  const deps: RunRouteCliDeps = {
    env: given.env ?? process.env,
    fetch: given.fetch ?? fetch,
    sleep: given.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    now: given.now ?? Date.now,
  };
  const key = deps.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is needed: it is the credential this command presents.');
  const origin = appRouteOrigin(deps.env);
  if (!origin) throw new Error("The app's address is not set (NEXT_PUBLIC_APP_URL).");

  const base = { path: input.path, askedBy: input.askedBy };
  let out = await post(deps, origin, key, { ...base, query: input.query ?? {} });
  let calls = 1;
  if (!input.untilField) return { ...out, done: null, calls };

  const everyMs = Math.max(5, input.everySeconds ?? 90) * 1000;
  const deadline = deps.now() + Math.max(1, input.maxMinutes ?? 30) * 60_000;
  while (out.status === 200 && !fieldIsTrue(out.body.result, input.untilField)) {
    if (deps.now() + everyMs > deadline) break;
    await deps.sleep(everyMs);
    out = await post(deps, origin, key, { ...base, query: input.thenQuery ?? input.query ?? {} });
    calls += 1;
  }
  return { ...out, done: out.status === 200 && fieldIsTrue(out.body.result, input.untilField), calls };
}
