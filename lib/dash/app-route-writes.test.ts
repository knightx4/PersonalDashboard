import { describe, expect, it, vi } from 'vitest';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import type { AppRouteResult } from '@/lib/dev/app-route';
import { APP_ROUTE_WRITE_TOOLS, RUN_APP_ROUTE, type DashAppRoutePort, type NewAppRoutePoll } from './app-route-writes';
import { ASK_DASH_TOOLS, DASH_TOOLS } from './registry';
import { PEOPLE_TOOLS } from '@/lib/you/people-actions';
import type { DashWriteContext, DashWriteResult } from './registry';

/**
 * run_app_route (plan #3070.3): one of the app's own cron routes run from a
 * chat, owner-only with Dev on, polled in the background when it is given a
 * field to wait on, and its result put on a step or raise.
 */

const ME = '00000000-0000-4000-8000-0000000000aa';
const STEP = '11111111-1111-4111-8111-111111111111';
const RAISE = 'e7f5413a-0000-4000-8000-000000000001';

function tables(): FakeTables {
  return {
    'public.plan_items': [{ id: STEP, user_id: ME, number: 2789 }],
    'public.plan_item_outlines': [{ user_id: ME, number: 2789, outline: '2789' }],
    'public.raised_items': [{ id: RAISE, user_id: ME, created_at: '2026-11-05T00:00:00Z' }],
  };
}

const ok = (result: unknown): AppRouteResult => ({ runId: 'run-1', outcome: 'ok', httpStatus: 200, result, resultBytes: 10, error: null });

function port(over: Partial<DashAppRoutePort> = {}, first: AppRouteResult = ok({ finished: false, delivered: 0 })) {
  const kept: NewAppRoutePoll[] = [];
  const comments: { ref: string; body: string }[] = [];
  const run = vi.fn(async () => first);
  const value: DashAppRoutePort = {
    isOwner: true,
    askedBy: 'bot:builder',
    replyTo: { advisorChatId: 'chat-1', advisorId: 'bot-1' },
    run,
    keepPoll: async (poll) => {
      kept.push(poll);
      return '22222222-2222-4222-8222-222222222222';
    },
    comment: async (input) => {
      comments.push(input);
    },
    ...over,
  };
  return { value, kept, comments, run };
}

function ctx(appRoute: DashAppRoutePort | null, modules: string[] = ['dev']) {
  const db = fakeSchemaDb(tables());
  return {
    userId: ME,
    today: '2026-11-08',
    enabledModules: modules,
    db: async (schema: string) => db(schema),
    searchSources: [],
    seen: {},
    now: Date.parse('2026-11-08T12:00:00Z'),
    ...(appRoute ? { appRoute: async () => appRoute } : {}),
  } as unknown as DashWriteContext;
}

const tool = APP_ROUTE_WRITE_TOOLS[0];
const apply = (c: DashWriteContext, input: Record<string, unknown>) => tool.apply(c, input) as Promise<DashWriteResult>;
const refusal = (result: DashWriteResult) => {
  if (result.ok) throw new Error(`expected a refusal, got ${result.summary}`);
  return result.error;
};

describe('the run_app_route schema', () => {
  it('takes the path, the queries, the field, the timing and post_to, and needs only the path', () => {
    const schema = tool.definition.input_schema as unknown as { properties: Record<string, unknown>; required: string[] };
    expect(tool.name).toBe(RUN_APP_ROUTE);
    expect(Object.keys(schema.properties).sort()).toEqual(
      ['max_minutes', 'path', 'poll_every_seconds', 'poll_until', 'post_to', 'query', 'then_query'].sort(),
    );
    expect(schema.required).toEqual(['path']);
  });

  it('is offered in Ask and to the People bots, never on the connector', () => {
    expect(DASH_TOOLS.some((t) => t.name === RUN_APP_ROUTE)).toBe(true);
    expect(ASK_DASH_TOOLS.some((t) => t.name === RUN_APP_ROUTE)).toBe(true);
    expect(PEOPLE_TOOLS.some((t) => t.name === RUN_APP_ROUTE)).toBe(true);
    expect(tool.inAppOnly).toBe(true);
  });

  it('never mentions the secret to the model', () => {
    expect(JSON.stringify(tool.definition)).not.toMatch(/CRON_SECRET|Bearer/);
  });
});

describe('who may run a route', () => {
  it('refuses anyone but the owner, and runs nothing', async () => {
    const p = port({ isOwner: false });
    expect(refusal(await apply(ctx(p.value), { path: '/api/cron/broker-wake-test' }))).toMatch(/only the account that owns/);
    expect(p.run).not.toHaveBeenCalled();
  });

  it('refuses with the Dev workspace off, and where there is no port', async () => {
    const p = port();
    expect(refusal(await apply(ctx(p.value, ['goals']), { path: '/api/cron/x' }))).toMatch(/Dev workspace is switched off/);
    expect(refusal(await apply(ctx(null), { path: '/api/cron/x' }))).toMatch(/No route can be run from here/);
    expect(p.run).not.toHaveBeenCalled();
  });

  it('passes on a refusal from the runner', async () => {
    const p = port({}, { runId: 'r', outcome: 'refused', httpStatus: null, result: null, resultBytes: null, error: '/api/dev/x is not on the list' });
    expect(refusal(await apply(ctx(p.value), { path: '/api/dev/x' }))).toMatch(/not on the list/);
  });
});

describe('running and polling', () => {
  it('starts the route with its query, keeps a poll with the later query, and returns at once', async () => {
    const p = port();
    const result = await apply(ctx(p.value), {
      path: '/api/cron/broker-wake-test',
      query: { start: 1 },
      then_query: {},
      poll_until: 'finished',
      post_to: '#2789',
    });
    expect(result.ok).toBe(true);
    expect(p.run).toHaveBeenCalledWith({ path: '/api/cron/broker-wake-test', query: { start: 1 }, askedBy: 'bot:builder' });
    expect(p.kept).toHaveLength(1);
    const poll = p.kept[0];
    expect(poll).toMatchObject({
      thenQuery: {},
      pollUntil: 'finished',
      everySeconds: 90,
      calls: 1,
      lastRunId: 'run-1',
      postToRef: `public.plan_items:${STEP}`,
      postToLabel: '#2789',
      replyTo: { advisorChatId: 'chat-1', advisorId: 'bot-1' },
      deadline: '2026-11-08T12:30:00.000Z',
      nextAt: '2026-11-08T12:01:30.000Z',
    });
    expect(p.comments).toHaveLength(0);
    if (result.ok) {
      expect(result.summary).toMatch(/again every 90 seconds for up to 30 minutes/);
      expect(result.undo).toEqual({ none: expect.any(String) });
      expect(result.subjectRef).toBe('public.app_route_polls:22222222-2222-4222-8222-222222222222');
    }
  });

  it('does not poll when the field is already true, and comments on the raise now', async () => {
    const p = port({}, ok({ finished: true, delivered: 3 }));
    const result = await apply(ctx(p.value), { path: '/api/cron/broker-wake-test', poll_until: 'finished', post_to: 'e7f5413a' });
    expect(p.kept).toHaveLength(0);
    expect(p.comments).toHaveLength(1);
    expect(p.comments[0].ref).toBe(`public.raised_items:${RAISE}`);
    expect(p.comments[0].body).toMatch(/delivered 3/);
    if (!result.ok) throw new Error(result.error);
    expect(result.summary).toMatch(/Numbers: finished true, delivered 3/);
  });

  it('refuses a post_to that names nothing before running anything', async () => {
    const p = port();
    expect(refusal(await apply(ctx(p.value), { path: '/api/cron/x', post_to: '#99999' }))).toMatch(/names no step/);
    expect(refusal(await apply(ctx(p.value), { path: '/api/cron/x', post_to: 'ffffffff' }))).toMatch(/No raise/);
    expect(p.run).not.toHaveBeenCalled();
  });

  it('refuses a poll interval outside its range', async () => {
    const p = port();
    expect(refusal(await apply(ctx(p.value), { path: '/api/cron/x', poll_until: 'finished', poll_every_seconds: 5 }))).toMatch(
      /poll_every_seconds/,
    );
  });
});
