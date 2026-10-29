import { describe, expect, it, vi } from 'vitest';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { DECISION_MAX } from '@/lib/you/board';
import { boardBrief, callBoardMeeting, cleanDecision, startBoardMeeting } from '@/lib/you/board-start';

const NOW = Date.parse('2026-11-02T12:00:00Z');
const routine = { id: 'rt', token: 'tk' };

type Call = { op: string; table: string; values?: Record<string, unknown>; filters: Array<[string, unknown[]]> };

/** A supabase-js double for you.board_meetings: records every write. */
function fakeYou(opts: { insertError?: { code: string; message: string } } = {}) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { op: 'select', table, filters: [] };
      calls.push(call);
      const builder: Record<string, unknown> = {};
      for (const m of ['eq', 'in', 'lt']) {
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
      builder.single = async () =>
        opts.insertError ? { data: null, error: opts.insertError } : { data: { id: 'meet-new' }, error: null };
      builder.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
      return builder;
    },
  };
  return { client: client as unknown as YouSupabaseClient, calls };
}

const okFetch = () =>
  vi.fn(async () => new Response(JSON.stringify({ claude_code_session_url: 'https://claude.ai/code/s1' }), { status: 200 }));
const sentText = (fetch: ReturnType<typeof okFetch>) =>
  JSON.parse((fetch.mock.calls[0] as unknown as [string, { body: string }])[1].body).text as string;

describe('cleanDecision', () => {
  it('makes one line and drops an empty one', () => {
    expect(cleanDecision('  Take the\n offer   in Austin ')).toBe('Take the offer in Austin');
    expect(cleanDecision(' \n ')).toBeNull();
  });
});

describe('boardBrief', () => {
  it('has the four lines the board skill reads', () => {
    expect(boardBrief({ meetingId: 'm1', userId: 'u1', decision: 'Take the offer?' }).split('\n')).toEqual([
      'Follow .claude/skills/board/SKILL.md',
      'Board meeting m1',
      'user_id u1',
      'called: Take the offer?',
    ]);
  });
});

describe('boardBrief with questions', () => {
  it('adds the questions line after the called line, in order', () => {
    const lines = boardBrief({ meetingId: 'm1', userId: 'u1', decision: 'Take it?', questionIds: ['q1', 'q2'] }).split('\n');
    expect(lines.slice(3)).toEqual(['called: Take it?', 'questions q1, q2']);
  });
});

describe('callBoardMeeting', () => {
  it('names the question in the brief and takes a question longer than a decision line', async () => {
    const { client } = fakeYou();
    const fetch = okFetch();
    const long = 'a'.repeat(DECISION_MAX + 100);
    const r = await callBoardMeeting({ client, userId: 'u1', decision: long, questionIds: ['q1'], routine, now: NOW, fetch });
    expect(r).toEqual({ started: true, meetingId: 'meet-new' });
    expect(sentText(fetch).split('\n').at(-1)).toBe('questions q1');
  });

  it('queues a called row naming the decision, fires the brief and saves the run url', async () => {
    const { client, calls } = fakeYou();
    const fetch = okFetch();
    const r = await callBoardMeeting({ client, userId: 'u1', decision: 'Take the offer?', routine, now: NOW, fetch });
    expect(r).toEqual({ started: true, meetingId: 'meet-new' });
    const insert = calls.find((c) => c.op === 'insert');
    expect(insert?.values).toMatchObject({ user_id: 'u1', kind: 'called', decision: 'Take the offer?', status: 'queued' });
    expect(sentText(fetch)).toContain('Board meeting meet-new');
    expect(sentText(fetch)).toContain('called: Take the offer?');
    expect(calls.some((c) => c.op === 'update' && c.values?.run_url === 'https://claude.ai/code/s1')).toBe(true);
  });

  it('marks a stale meeting failed before it inserts', async () => {
    const { client, calls } = fakeYou();
    await callBoardMeeting({ client, userId: 'u1', decision: 'x', routine, now: NOW, fetch: okFetch() });
    expect(calls[0].op).toBe('update');
    expect(calls[0].values?.status).toBe('failed');
    expect(calls[0].filters).toContainEqual(['eq', ['user_id', 'u1']]);
  });

  it('says a meeting is running and fires nothing when the unique index refuses a second', async () => {
    const { client } = fakeYou({ insertError: { code: '23505', message: 'duplicate' } });
    const fetch = okFetch();
    const r = await callBoardMeeting({ client, userId: 'u1', decision: 'x', routine, now: NOW, fetch });
    expect(r).toMatchObject({ started: false, reason: 'running', error: expect.stringContaining('already running') });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('marks the row failed with the answer when the fire fails', async () => {
    const { client, calls } = fakeYou();
    const fetch = vi.fn(async () => new Response('nope', { status: 500 }));
    const r = await callBoardMeeting({ client, userId: 'u1', decision: 'x', routine, now: NOW, fetch });
    expect(r).toMatchObject({ started: false, reason: 'error' });
    const failed = calls.filter(
      (c) => c.op === 'update' && String(c.values?.error).startsWith('Dash could not start the meeting.'),
    );
    expect(failed).toHaveLength(1);
    expect(failed[0].values?.status).toBe('failed');
    expect(failed[0].filters).toContainEqual(['eq', ['id', 'meet-new']]);
  });

  it('starts nothing without the routine, and nothing for a blank or long decision', async () => {
    const { client, calls } = fakeYou();
    expect(
      await callBoardMeeting({ client, userId: 'u1', decision: 'x', routine: { id: null, token: null }, now: NOW }),
    ).toMatchObject({ started: false, reason: 'no_routine' });
    expect(await callBoardMeeting({ client, userId: 'u1', decision: '  ', routine, now: NOW })).toMatchObject({
      started: false,
      reason: 'invalid',
    });
    expect(
      await callBoardMeeting({ client, userId: 'u1', decision: 'a'.repeat(DECISION_MAX + 1), routine, now: NOW }),
    ).toMatchObject({ started: false, reason: 'invalid' });
    expect(calls).toHaveLength(0);
  });
});

describe('startBoardMeeting', () => {
  const career = { id: 'p-career', name: 'Career', topic: null, advisors: ['hiring_manager', 'mentor', 'seneca'] };

  it('queues a weekly meeting with the panel copied on and names the panel in the brief', async () => {
    const { client, calls } = fakeYou();
    const fetch = okFetch();
    const r = await startBoardMeeting({ client, userId: 'u1', panel: career, routine, now: NOW, fetch });
    expect(r).toEqual({ started: true, meetingId: 'meet-new' });
    expect(calls.find((c) => c.op === 'insert')?.values).toEqual({
      user_id: 'u1',
      kind: 'weekly',
      panel_id: 'p-career',
      panel_name: 'Career',
      panel_topic: null,
      panel_advisors: ['hiring_manager', 'mentor', 'seneca'],
      status: 'queued',
    });
    expect(sentText(fetch).split('\n')).toEqual([
      'Follow .claude/skills/board/SKILL.md',
      'Board meeting meet-new',
      'user_id u1',
      'weekly',
      'panel p-career',
    ]);
  });

  it('starts a meeting for no panel with the four panel columns left off', async () => {
    const { client, calls } = fakeYou();
    const fetch = okFetch();
    await startBoardMeeting({ client, userId: 'u1', panel: null, routine, now: NOW, fetch });
    expect(calls.find((c) => c.op === 'insert')?.values).toEqual({ user_id: 'u1', kind: 'weekly', status: 'queued' });
    expect(sentText(fetch)).not.toContain('panel');
  });

  it('says one is already running, and refuses a panel with no advisors', async () => {
    const taken = fakeYou({ insertError: { code: '23505', message: 'dup' } });
    const r = await startBoardMeeting({ client: taken.client, userId: 'u1', panel: null, routine, now: NOW, fetch: okFetch() });
    expect(r).toMatchObject({ started: false, reason: 'running' });
    const empty = fakeYou();
    const e = await startBoardMeeting({ client: empty.client, userId: 'u1', panel: { ...career, advisors: [] }, routine, now: NOW });
    expect(e).toMatchObject({ started: false, reason: 'invalid' });
    expect(empty.calls.some((c) => c.op === 'insert')).toBe(false);
  });
});
