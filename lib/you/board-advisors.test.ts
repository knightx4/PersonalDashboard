import { describe, expect, it, vi } from 'vitest';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import {
  addAdvisor,
  advisorBrief,
  advisorKey,
  brainState,
  BUILD_STALE_AFTER_MS,
  cleanAdvisor,
  retryBuild,
  rosterOf,
  setActive,
} from '@/lib/you/board-advisors';

const NOW = Date.parse('2026-11-02T12:00:00Z');
const routine = { id: 'rt', token: 'tk' };
const USER = 'u1';

type Call = { op: string; values?: Record<string, unknown>; filters: Array<[string, unknown[]]> };

/** A supabase-js double for you.board_advisors: records every write; `rows` answers selects. */
function fakeYou(rows: Array<Record<string, unknown>> = [], insertId = 'adv-new') {
  const calls: Call[] = [];
  const client = {
    from() {
      const call: Call = { op: 'select', filters: [] };
      calls.push(call);
      const builder: Record<string, unknown> = {};
      for (const m of ['eq']) {
        builder[m] = (...args: unknown[]) => {
          call.filters.push([m, args]);
          return builder;
        };
      }
      builder.select = () => builder;
      builder.update = (v: Record<string, unknown>) => {
        call.op = 'update';
        call.values = v;
        return builder;
      };
      builder.insert = (v: Record<string, unknown>) => {
        call.op = 'insert';
        call.values = v;
        return builder;
      };
      builder.single = async () => ({ data: { id: insertId }, error: null });
      builder.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
      builder.then = (resolve: (v: unknown) => void) =>
        resolve({ data: call.op === 'select' || call.op === 'update' ? rows : null, error: null });
      return builder;
    },
  };
  return { client: client as unknown as YouSupabaseClient, calls };
}

const okFetch = () => vi.fn(async () => new Response('{}', { status: 200 }));
const row = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  key: 'franklin',
  name: 'Benjamin Franklin',
  kind: 'guest',
  question: 'Is this useful?',
  focus: null,
  brain_status: 'ready',
  brain: { sources: [1, 2, 3] },
  active: true,
  added_by: 'person',
  updated_at: '2026-11-02T11:00:00Z',
  ...over,
});

describe('advisorKey', () => {
  it('slugs a name and numbers a taken one', () => {
    expect(advisorKey('Leonardo da Vinci', [])).toBe('leonardo_da_vinci');
    expect(advisorKey('Zoë Kravitz', [])).toBe('zoe_kravitz');
    expect(advisorKey('Warren Buffett', ['warren_buffett'])).toBe('warren_buffett_2');
    expect(advisorKey('???', [])).toBe('advisor');
    expect(advisorKey('x'.repeat(100), [])).toMatch(/^[a-z0-9_]{1,40}$/);
  });
});

describe('cleanAdvisor', () => {
  it('needs a name and keeps the focus optional', () => {
    expect(cleanAdvisor({ name: '  ' })).toMatchObject({ ok: false });
    expect(cleanAdvisor({ name: ' Marcus   Aurelius ', focus: '' })).toEqual({
      ok: true,
      value: { name: 'Marcus Aurelius', focus: null },
    });
    expect(cleanAdvisor({ name: 'a', focus: 'x'.repeat(301) })).toMatchObject({ ok: false });
  });
});

describe('brainState', () => {
  const advisor = (over: Record<string, unknown>) => rosterOf(row(over))!;
  it('reads a seat, a ready brain and a failed one with its reason', () => {
    expect(brainState(advisor({ kind: 'seat', brain_status: 'none', brain: null }), NOW).kind).toBe('seat');
    expect(brainState(advisor({}), NOW)).toEqual({ kind: 'ready', sources: 3 });
    expect(brainState(advisor({ brain_status: 'failed', brain: { error: 'Only seven opened.' } }), NOW)).toEqual({
      kind: 'failed',
      why: 'Only seven opened.',
    });
  });
  it('calls a build lost with its session failed', () => {
    const stale = new Date(NOW - BUILD_STALE_AFTER_MS - 1000).toISOString();
    expect(brainState(advisor({ brain_status: 'building', brain: null, updated_at: stale }), NOW).kind).toBe('failed');
    expect(brainState(advisor({ brain_status: 'building', brain: null }), NOW).kind).toBe('building');
  });
});

describe('addAdvisor', () => {
  it('saves a building row and fires the build with its id', async () => {
    const { client, calls } = fakeYou([]);
    const fetch = okFetch();
    const result = await addAdvisor({ client, userId: USER, name: 'Marcus Aurelius', focus: 'Duty', routine, fetch });
    expect(result).toEqual({ error: null, advisorId: 'adv-new' });
    const insert = calls.find((c) => c.op === 'insert')!;
    expect(insert.values).toMatchObject({
      user_id: USER,
      key: 'marcus_aurelius',
      kind: 'guest',
      brain_status: 'building',
      added_by: 'person',
      focus: 'Duty',
    });
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, { body: string }])[1].body).text as string;
    expect(body).toBe(advisorBrief({ advisorId: 'adv-new', userId: USER }));
    expect(body).toContain('Build advisor adv-new');
  });

  it('marks the row failed with the reason when the routine is not set up', async () => {
    const { client, calls } = fakeYou([]);
    const result = await addAdvisor({ client, userId: USER, name: 'Marcus Aurelius', routine: { id: null, token: null } });
    expect(result.advisorId).toBe('adv-new');
    expect(result.error).toContain('CLAUDE_BOARD_ROUTINE_ID');
    const update = calls.find((c) => c.op === 'update')!;
    expect(update.values).toMatchObject({ brain_status: 'failed' });
    expect(update.filters).toContainEqual(['eq', ['user_id', USER]]);
  });

  it('refuses a name already on the board', async () => {
    const { client, calls } = fakeYou([row()]);
    const result = await addAdvisor({ client, userId: USER, name: 'benjamin franklin', routine, fetch: okFetch() });
    expect(result.error).toContain('already on your board');
    expect(calls.some((c) => c.op === 'insert')).toBe(false);
  });
});

describe('retryBuild', () => {
  it('moves a failed guest to building and fires again', async () => {
    const { client, calls } = fakeYou([row({ brain_status: 'failed', brain: { error: 'x' } })]);
    const fetch = okFetch();
    const result = await retryBuild({ client, userId: USER, advisorId: 'a1', routine, now: NOW, fetch });
    expect(result).toEqual({ started: true });
    expect(calls.find((c) => c.op === 'update')!.values).toEqual({ brain_status: 'building', brain: null });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not rebuild a ready brain or one being built', async () => {
    const ready = fakeYou([row()]);
    expect(await retryBuild({ client: ready.client, userId: USER, advisorId: 'a1', routine, now: NOW })).toMatchObject({
      started: false,
    });
    const going = fakeYou([row({ brain_status: 'building', brain: null })]);
    expect(await retryBuild({ client: going.client, userId: USER, advisorId: 'a1', routine, now: NOW })).toMatchObject({
      started: false,
    });
  });
});

describe('setActive', () => {
  it('writes the switch for a guest of this user only', async () => {
    const { client, calls } = fakeYou([{ id: 'a1' }]);
    expect(await setActive({ client, userId: USER, advisorId: 'a1', active: false })).toEqual({ error: null });
    const update = calls.find((c) => c.op === 'update')!;
    expect(update.values).toEqual({ active: false });
    expect(update.filters).toEqual(
      expect.arrayContaining([
        ['eq', ['user_id', USER]],
        ['eq', ['kind', 'guest']],
      ]),
    );
  });
  it('says so when no guest matched', async () => {
    const { client } = fakeYou([]);
    expect((await setActive({ client, userId: USER, advisorId: 'zz', active: true })).error).toContain('not one of your guests');
  });
});
