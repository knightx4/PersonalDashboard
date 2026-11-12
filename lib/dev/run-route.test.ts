import { describe, expect, it, vi } from 'vitest';
import type { AppRouteStore } from '@/lib/dev/app-route';
import { handleRunRoute, isSessionAuthorised } from '@/lib/dev/run-route';
import { parseQueryPairs, parseThenQuery, runRouteFromCli } from '@/lib/dev/run-route-client';

const KEY = 'service-role-key-abc';
const SECRET = 'cron-secret-value-123';
const ENV = {
  SUPABASE_SERVICE_ROLE_KEY: KEY,
  CRON_SECRET: SECRET,
  VERCEL_PROJECT_PRODUCTION_URL: 'dash.example.com',
  NEXT_PUBLIC_APP_URL: 'https://dash.example.com',
};
const AUTH = `Bearer ${KEY}`;

function store(): AppRouteStore {
  let n = 0;
  return {
    start: async () => `run-${++n}`,
    finish: async () => {},
    refuse: async () => `run-${++n}`,
  };
}
const json = (body: unknown, status = 200) =>
  vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );

describe('isSessionAuthorised', () => {
  it('takes the service-role key and nothing else', () => {
    expect(isSessionAuthorised(AUTH, ENV)).toBe(true);
    expect(isSessionAuthorised(`Bearer ${SECRET}`, ENV)).toBe(false);
    expect(isSessionAuthorised('Bearer ', ENV)).toBe(false);
    expect(isSessionAuthorised(null, ENV)).toBe(false);
  });
  it('refuses everything when no key is set', () => {
    expect(isSessionAuthorised('Bearer ', {})).toBe(false);
    expect(isSessionAuthorised('Bearer undefined', {})).toBe(false);
  });
});

describe('handleRunRoute', () => {
  it('answers 401 without the credential and calls nothing', async () => {
    const fetch = json({ ok: true });
    for (const authorization of [null, 'Bearer wrong', `Bearer ${SECRET}`]) {
      const out = await handleRunRoute({ authorization, body: { path: '/api/cron/x' } }, { env: ENV, store: store(), fetch });
      expect(out.status).toBe(401);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('runs an allowlisted route and returns its JSON without the secret', async () => {
    const fetch = json({ ok: true, echoed: SECRET });
    const out = await handleRunRoute(
      { authorization: AUTH, body: { path: '/api/cron/broker-wake-test', query: { start: 1 }, askedBy: 'session:abc' } },
      { env: ENV, store: store(), fetch },
    );
    expect(out.status).toBe(200);
    expect(out.body.outcome).toBe('ok');
    expect(JSON.stringify(out.body)).not.toContain(SECRET);
    expect(JSON.stringify(out.body)).not.toContain(KEY);
    expect(String(fetch.mock.calls[0][0])).toBe('https://dash.example.com/api/cron/broker-wake-test?start=1');
  });

  it('answers 400 for a path off the allowlist or on another host, and calls nothing', async () => {
    const fetch = json({ ok: true });
    for (const path of ['/api/dev/run-route', '/api/auth/gmail/connect', '//evil.com/api/cron/x', 'https://evil.com/api/cron/x', '/api/cron/x?a=1']) {
      const out = await handleRunRoute({ authorization: AUTH, body: { path } }, { env: ENV, store: store(), fetch });
      expect(out.status).toBe(400);
      expect(out.body.outcome).toBe('refused');
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('answers 400 for a body with no path', async () => {
    const deps = { env: ENV, store: store(), fetch: json({}) };
    expect((await handleRunRoute({ authorization: AUTH, body: {} }, deps)).status).toBe(400);
    expect((await handleRunRoute({ authorization: AUTH, body: null }, deps)).status).toBe(400);
  });

  it('answers 502 when the route fails', async () => {
    const out = await handleRunRoute({ authorization: AUTH, body: { path: '/api/cron/x' } }, { env: ENV, store: store(), fetch: json({ error: 'boom' }, 500) });
    expect(out.status).toBe(502);
    expect(out.body.outcome).toBe('failed');
  });

  it('polls until the field is true', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ finished: false })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ finished: true })));
    const out = await handleRunRoute(
      { authorization: AUTH, body: { path: '/api/cron/x', query: { start: 1 }, poll: { untilField: 'finished', thenQuery: {}, everySeconds: 5 } } },
      { env: ENV, store: store(), fetch, sleep: async () => {} },
    );
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ done: true, calls: 2 });
    expect(String(fetch.mock.calls[1][0])).toBe('https://dash.example.com/api/cron/x');
  });
});

describe('runRouteFromCli', () => {
  it('posts to the app with the service-role key and never sends CRON_SECRET', async () => {
    const fetch = json({ outcome: 'ok', result: { ok: true } });
    const out = await runRouteFromCli({ path: '/api/cron/x', query: { a: 1 }, askedBy: 'session:s' }, { env: ENV, fetch });
    expect(out.status).toBe(200);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://dash.example.com/api/dev/run-route');
    expect((init.headers as Record<string, string>).Authorization).toBe(AUTH);
    expect(JSON.stringify(init)).not.toContain(SECRET);
  });

  it('needs the key', async () => {
    await expect(runRouteFromCli({ path: '/api/cron/x', askedBy: 's' }, { env: { ...ENV, SUPABASE_SERVICE_ROLE_KEY: '' } })).rejects.toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('polls with the then-query until done', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { finished: false } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { finished: true } })));
    const out = await runRouteFromCli(
      { path: '/api/cron/x', query: { start: 1 }, thenQuery: {}, untilField: 'finished', askedBy: 's' },
      { env: ENV, fetch, sleep: async () => {} },
    );
    expect(out).toMatchObject({ done: true, calls: 2 });
    expect(JSON.parse((fetch.mock.calls[1][1] as RequestInit).body as string).query).toEqual({});
  });

  it('parses name=value pairs', () => {
    expect(parseQueryPairs(['start=1', 'x=a=b', 'on=true'])).toEqual({ start: 1, x: 'a=b', on: true });
    expect(() => parseQueryPairs(['nope'])).toThrow();
  });

  it('reads --then: absent repeats the first query, bare gives an empty one', () => {
    expect(parseThenQuery(['--until', 'finished'])).toBeUndefined();
    expect(parseThenQuery(['--until', 'finished', '--then'])).toEqual({});
    expect(parseThenQuery(['--then', '--every', '5'])).toEqual({});
    expect(parseThenQuery(['--then', 'a=1', '--then', 'b=x'])).toEqual({ a: 1, b: 'x' });
  });
});
