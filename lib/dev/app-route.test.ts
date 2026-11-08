import { describe, expect, it, vi } from 'vitest';
import {
  APP_ROUTE_CONCURRENCY,
  appRouteOrigin,
  pollAppRoute,
  refuseAppRoutePath,
  runAppRoute,
  type AppRouteStore,
} from '@/lib/dev/app-route';

const SECRET = 'cron-secret-value-123';
const ENV = {
  CRON_SECRET: SECRET,
  VERCEL_PROJECT_PRODUCTION_URL: 'dash.example.com',
  NEXT_PUBLIC_APP_URL: 'https://dash.example.com',
};

type Row = { id: string; status: string; path: string; askedBy: string; error: string | null; result?: unknown; httpStatus?: number | null };

/** An in-memory public.app_route_runs that counts running rows the way start_app_route_run does. */
function memoryStore() {
  const rows: Row[] = [];
  let n = 0;
  const store: AppRouteStore = {
    async start({ askedBy, path, limit }) {
      const running = rows.filter((r) => r.status === 'running').length;
      const id = `run-${++n}`;
      if (running >= limit) {
        rows.push({ id, status: 'refused', path, askedBy, error: 'limit' });
        return null;
      }
      rows.push({ id, status: 'running', path, askedBy, error: null });
      return id;
    },
    async finish({ id, status, httpStatus, result, error }) {
      const row = rows.find((r) => r.id === id && r.status === 'running');
      if (row) Object.assign(row, { status, httpStatus, result, error });
    },
    async refuse({ askedBy, path, error }) {
      const id = `run-${++n}`;
      rows.push({ id, status: 'refused', path, askedBy, error });
      return id;
    },
  };
  return { store, rows };
}

function jsonFetch(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

describe('the allowlist', () => {
  it.each([
    '/api/cron/broker-wake-test',
    '/api/cron/learn-prepare',
    '/api/cron/a/b',
  ])('lets %s through', (path) => {
    expect(refuseAppRoutePath(path)).toBeNull();
  });

  it.each([
    'https://evil.example.com/api/cron/x',
    '//evil.example.com/api/cron/x',
    '/api/dev/run-route',
    '/api/cron/',
    '/api/cron/../dev/plan',
    '/api/cron/x?start=1',
    'api/cron/x',
    '/API/CRON/x',
    '',
  ])('refuses %s', (path) => {
    expect(refuseAppRoutePath(path)).not.toBeNull();
  });

  it('refuses a path off the list without calling anything, and logs it refused', async () => {
    const { store, rows } = memoryStore();
    const fetch = jsonFetch({ ok: true });
    const run = await runAppRoute({ path: '/api/dev/plan', askedBy: 'session:x' }, { store, fetch, env: ENV });
    expect(run.outcome).toBe('refused');
    expect(fetch).not.toHaveBeenCalled();
    expect(rows).toEqual([expect.objectContaining({ status: 'refused', path: '/api/dev/plan', askedBy: 'session:x' })]);
  });

  it('refuses another host given as the path', async () => {
    const { store } = memoryStore();
    const fetch = jsonFetch({ ok: true });
    const run = await runAppRoute({ path: 'https://evil.example.com/api/cron/x', askedBy: 'dash' }, { store, fetch, env: ENV });
    expect(run.outcome).toBe('refused');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses a query name that could smuggle anything', async () => {
    const { store } = memoryStore();
    const fetch = jsonFetch({ ok: true });
    const run = await runAppRoute({ path: '/api/cron/x', query: { 'a&b': '1' }, askedBy: 'dash' }, { store, fetch, env: ENV });
    expect(run.outcome).toBe('refused');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('calls only the custom domain, never a vercel.app host', () => {
    expect(appRouteOrigin({ VERCEL_PROJECT_PRODUCTION_URL: 'dash.example.com' })).toBe('https://dash.example.com');
    expect(appRouteOrigin({ VERCEL_PROJECT_PRODUCTION_URL: 'x.vercel.app', NEXT_PUBLIC_APP_URL: 'https://dash.example.com/' })).toBe(
      'https://dash.example.com',
    );
    expect(appRouteOrigin({ NEXT_PUBLIC_APP_URL: 'https://x.vercel.app' })).toBeNull();
    expect(appRouteOrigin({})).toBeNull();
  });

  it('calls GET on the app with the query and the secret in the header', async () => {
    const { store, rows } = memoryStore();
    const fetch = jsonFetch({ ok: true, finished: false });
    const run = await runAppRoute({ path: '/api/cron/broker-wake-test', query: { start: 1 }, askedBy: 'bot:maya' }, { store, fetch, env: ENV });
    expect(run).toMatchObject({ outcome: 'ok', httpStatus: 200, result: { ok: true, finished: false } });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://dash.example.com/api/cron/broker-wake-test?start=1');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
    expect(init.redirect).toBe('manual');
    expect(rows[0]).toMatchObject({ status: 'ok', httpStatus: 200 });
  });
});

describe('the secret', () => {
  it('is redacted from a body that echoes it, in the result and on the log', async () => {
    const { store, rows } = memoryStore();
    const fetch = jsonFetch({ seen: `Bearer ${SECRET}`, [SECRET]: [SECRET] });
    const run = await runAppRoute({ path: '/api/cron/x', askedBy: 'dash' }, { store, fetch, env: ENV });
    expect(JSON.stringify(run)).not.toContain(SECRET);
    expect(JSON.stringify(rows)).not.toContain(SECRET);
  });

  it('is redacted from a text body and from a failed call', async () => {
    const { store, rows } = memoryStore();
    const fetch = vi.fn(async () => new Response(`denied for ${SECRET}`, { status: 401 }));
    const run = await runAppRoute({ path: '/api/cron/x', askedBy: 'dash' }, { store, fetch, env: ENV });
    expect(run.outcome).toBe('failed');
    expect(run.result).toBe('denied for [redacted]');
    expect(JSON.stringify(run)).not.toContain(SECRET);
    expect(JSON.stringify(rows)).not.toContain(SECRET);
  });

  it('is redacted from a thrown error', async () => {
    const { store, rows } = memoryStore();
    const fetch = vi.fn(async () => {
      throw new Error(`socket closed after Authorization: Bearer ${SECRET}`);
    });
    const run = await runAppRoute({ path: '/api/cron/x', askedBy: 'dash' }, { store, fetch, env: ENV });
    expect(run.outcome).toBe('failed');
    expect(run.error).toContain('[redacted]');
    expect(JSON.stringify(run)).not.toContain(SECRET);
    expect(JSON.stringify(rows)).not.toContain(SECRET);
  });

  it('is never logged to the console', async () => {
    const spies = (['log', 'error', 'warn', 'info'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const { store } = memoryStore();
    await runAppRoute({ path: '/api/cron/x', askedBy: 'dash' }, { store, fetch: jsonFetch({ a: SECRET }), env: ENV });
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET);
      spy.mockRestore();
    }
  });

  it('refuses to run with no secret on the server', async () => {
    const { store } = memoryStore();
    const fetch = jsonFetch({});
    const run = await runAppRoute({ path: '/api/cron/x', askedBy: 'dash' }, { store, fetch, env: { ...ENV, CRON_SECRET: '' } });
    expect(run.outcome).toBe('refused');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('the concurrency limit', () => {
  it(`refuses run ${APP_ROUTE_CONCURRENCY + 1} while ${APP_ROUTE_CONCURRENCY} are going, and lets one through after`, async () => {
    const { store, rows } = memoryStore();
    const release: Array<() => void> = [];
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release.push(() => resolve(new Response('{"ok":true}', { status: 200 })));
        }),
    );
    const deps = { store, fetch: fetch as unknown as typeof globalThis.fetch, env: ENV };
    const going = Array.from({ length: APP_ROUTE_CONCURRENCY }, (_, i) => runAppRoute({ path: '/api/cron/x', askedBy: `s${i}` }, deps));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(APP_ROUTE_CONCURRENCY));

    const fourth = await runAppRoute({ path: '/api/cron/x', askedBy: 's4' }, deps);
    expect(fourth.outcome).toBe('refused');
    expect(fetch).toHaveBeenCalledTimes(APP_ROUTE_CONCURRENCY);
    expect(rows.filter((r) => r.status === 'refused')).toHaveLength(1);

    release.forEach((r) => r());
    expect((await Promise.all(going)).map((r) => r.outcome)).toEqual(Array(APP_ROUTE_CONCURRENCY).fill('ok'));

    const fifth = runAppRoute({ path: '/api/cron/x', askedBy: 's5' }, deps);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(APP_ROUTE_CONCURRENCY + 1));
    release[release.length - 1]();
    expect((await fifth).outcome).toBe('ok');
  });
});

describe('polling', () => {
  it('calls again with the follow-on query until the field is true', async () => {
    const { store } = memoryStore();
    const bodies = [{ finished: false }, { finished: false }, { finished: true, fired: 10 }];
    const fetch = vi.fn(async () => new Response(JSON.stringify(bodies.shift()), { status: 200 }));
    const sleep = vi.fn(async () => {});
    const done = await pollAppRoute(
      { path: '/api/cron/broker-wake-test', query: { start: 1 }, thenQuery: {}, askedBy: 'dash', untilField: 'finished', everySeconds: 90 },
      { store, fetch, env: ENV, sleep, now: () => 0 },
    );
    expect(done).toMatchObject({ done: true, calls: 3, last: { result: { finished: true, fired: 10 } } });
    const urls = fetch.mock.calls.map((c) => (c as unknown as [string])[0]);
    expect(urls[0]).toContain('?start=1');
    expect(urls[1]).not.toContain('start');
    expect(sleep).toHaveBeenCalledWith(90_000);
  });

  it('stops when the time runs out', async () => {
    const { store } = memoryStore();
    let clock = 0;
    const fetch = vi.fn(async () => new Response('{"finished":false}', { status: 200 }));
    const done = await pollAppRoute(
      { path: '/api/cron/x', askedBy: 'dash', untilField: 'finished', everySeconds: 60, maxMinutes: 3 },
      { store, fetch, env: ENV, sleep: async (ms) => void (clock += ms), now: () => clock },
    );
    expect(done.done).toBe(false);
    expect(done.calls).toBe(4);
  });

  it('stops at a call that fails', async () => {
    const { store } = memoryStore();
    const fetch = vi.fn(async () => new Response('{"error":"x"}', { status: 500 }));
    const done = await pollAppRoute(
      { path: '/api/cron/x', askedBy: 'dash', untilField: 'finished' },
      { store, fetch, env: ENV, sleep: async () => {}, now: () => 0 },
    );
    expect(done).toMatchObject({ done: false, calls: 1, last: { outcome: 'failed', httpStatus: 500 } });
  });
});
