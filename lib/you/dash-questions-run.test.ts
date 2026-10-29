import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import {
  DASH_QUESTIONS_SKILL_PATH,
  dashQuestionsBrief,
  QUESTION_RUN_STALE_AFTER_MS,
  questionRunFromRow,
  questionRunState,
  STALE_QUESTION_RUN_ERROR,
  startQuestionRun,
  type DashQuestionRun,
} from './dash-questions-run';

type Call = { op: string; args: unknown[] };
type Answer = { data: unknown; error: null | { message: string; code?: string } };

/** Records every call; each awaited query takes the next answer. */
function fakeClient(...answers: Answer[]) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      calls.push({ op: 'from', args: [table] });
      const query: Record<string, unknown> = {};
      for (const op of ['select', 'insert', 'update', 'eq', 'in', 'lt', 'single']) {
        query[op] = (...args: unknown[]) => {
          calls.push({ op, args });
          return query;
        };
      }
      query.then = (resolve: (value: Answer) => unknown) => resolve(answers.shift() ?? { data: null, error: null });
      return query;
    },
  } as unknown as YouSupabaseClient;
  return { client, calls };
}

const ROUTINE = { id: 'trig_1', token: 'tok' };
const NOW = Date.parse('2026-10-29T12:00:00Z');

function okFetch(body: unknown) {
  const sent: { url: string; body: string }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, body: String(init.body) });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, sent };
}

const run = (extra: Partial<DashQuestionRun> = {}): DashQuestionRun => ({
  id: 'r1',
  status: 'running',
  summary: null,
  error: null,
  runUrl: null,
  requestedAt: '2026-10-29T11:30:00Z',
  finishedAt: null,
  ...extra,
});

describe('dashQuestionsBrief', () => {
  it('hands the session to the skill and names the run and the account', () => {
    expect(dashQuestionsBrief({ runId: 'r1', userId: 'u1' })).toBe(
      'Follow .claude/skills/dash-questions/SKILL.md\nQuestion run r1\nuser_id u1',
    );
  });
});

describe('questionRunState', () => {
  it('reads a run as running until the stale mark, then failed', () => {
    expect(questionRunState(null).kind).toBe('none');
    expect(questionRunState(run(), NOW).kind).toBe('running');
    const late = NOW + QUESTION_RUN_STALE_AFTER_MS;
    expect(questionRunState(run(), late)).toEqual({ kind: 'failed', run: run(), error: STALE_QUESTION_RUN_ERROR });
  });

  it('says why a failed run failed, and reads a finished one as ready', () => {
    const failed = questionRunState(run({ status: 'failed', error: 'No notes.' }), NOW);
    expect(failed.kind === 'failed' && failed.error).toBe('No notes.');
    expect(questionRunState(run({ status: 'ready' }), NOW).kind).toBe('ready');
  });
});

describe('questionRunFromRow', () => {
  it('reads an unknown status as failed and keeps only an https link', () => {
    const row = questionRunFromRow({ id: 'r1', status: 'odd', run_url: 'javascript:x', requested_at: 'x' });
    expect(row.status).toBe('failed');
    expect(row.runUrl).toBeNull();
    expect(questionRunFromRow({ id: 'r1', status: 'ready', run_url: 'https://claude.ai/s' }).runUrl).toBe(
      'https://claude.ai/s',
    );
  });
});

describe('startQuestionRun', () => {
  it('says so when the deployment has no goals routine, and touches nothing', async () => {
    const { client, calls } = fakeClient();
    const result = await startQuestionRun({ client, userId: 'u1', routine: { id: null, token: null } });
    expect(result).toMatchObject({ started: false, reason: 'no_routine' });
    expect(calls).toHaveLength(0);
  });

  it('queues a run, fires the routine with the brief and keeps the session link', async () => {
    const { client, calls } = fakeClient(
      { data: null, error: null },
      { data: { id: 'r9' }, error: null },
      { data: null, error: null },
    );
    const { fetch, sent } = okFetch({ claude_code_session_url: 'https://claude.ai/code/s1' });
    const result = await startQuestionRun({ client, userId: 'u1', routine: ROUTINE, now: NOW, fetch });
    expect(result).toEqual({ started: true, runId: 'r9' });
    expect(calls).toContainEqual({ op: 'insert', args: [{ user_id: 'u1', status: 'queued' }] });
    expect(calls).toContainEqual({
      op: 'lt',
      args: ['requested_at', new Date(NOW - QUESTION_RUN_STALE_AFTER_MS).toISOString()],
    });
    expect(JSON.parse(sent[0].body).text).toBe(dashQuestionsBrief({ runId: 'r9', userId: 'u1' }));
    expect(calls).toContainEqual({ op: 'update', args: [{ run_url: 'https://claude.ai/code/s1' }] });
    expect(calls.filter((c) => c.op === 'eq' && c.args[0] === 'user_id')).toHaveLength(2);
  });

  it('refuses a second press while a run is open, without firing', async () => {
    const { client } = fakeClient({ data: null, error: null }, { data: null, error: { message: 'dup', code: '23505' } });
    const { fetch, sent } = okFetch({});
    const result = await startQuestionRun({ client, userId: 'u1', routine: ROUTINE, now: NOW, fetch });
    expect(result).toEqual({ started: false, reason: 'running', error: 'Dash is already writing questions.' });
    expect(sent).toHaveLength(0);
  });

  it('marks the run failed when the routine cannot be fired', async () => {
    const { client, calls } = fakeClient({ data: null, error: null }, { data: { id: 'r9' }, error: null });
    const fetch = (async () => {
      throw new Error('offline');
    }) as unknown as typeof globalThis.fetch;
    const result = await startQuestionRun({ client, userId: 'u1', routine: ROUTINE, now: NOW, fetch });
    expect(result).toMatchObject({ started: false, reason: 'error', error: 'offline' });
    const failed = calls.filter((c) => c.op === 'update').at(-1)?.args[0] as Record<string, unknown>;
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('Dash could not start the run. offline');
  });
});

describe('the dash-questions skill', () => {
  const skill = readFileSync(join(process.cwd(), DASH_QUESTIONS_SKILL_PATH), 'utf8');

  it('is named for the brief that fires it', () => {
    expect(skill.startsWith('---\nname: dash-questions\n')).toBe(true);
    expect(skill).toContain('Follow .claude/skills/dash-questions/SKILL.md');
    expect(skill).toContain('Question run <run id>');
  });

  it('writes under the run, never repeats a question and scopes every write to the owner', () => {
    expect(skill).toContain('at most five');
    expect(skill).toContain("'<run id>'");
    expect(skill).toContain('lower(btrim(d.question)) = lower(btrim(v.question))');
    const writes = skill.match(/^(update|insert into) [^\n]+(\n(?!```)[^\n]*)*/gm) ?? [];
    expect(writes.length).toBeGreaterThanOrEqual(4);
    for (const statement of writes) expect(statement).toContain("'<user_id>'");
  });

  it('names Dash, never Claude, in what the person reads', () => {
    expect(skill).not.toMatch(/\$s\$[^$]*Claude/);
  });
});
