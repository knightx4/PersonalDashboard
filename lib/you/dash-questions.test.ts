import { describe, expect, it } from 'vitest';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import {
  addDashQuestions,
  answerDashQuestion,
  answerError,
  editDashAnswer,
  loadDashQuestions,
  skipDashQuestion,
  splitDashQuestions,
  type DashQuestion,
} from '@/lib/you/dash-questions';

type Call = { op: string; args: unknown[] };
type Answer = { data: unknown; error: null | { message: string } };

/**
 * A query that records every call on you.dash_questions. Each awaited query
 * takes the next answer given, so a read followed by a write can answer each.
 */
function fakeClient(...answers: Answer[]) {
  const calls: Call[] = [];
  const tables: string[] = [];
  const client = {
    from(table: string) {
      tables.push(table);
      const query: Record<string, unknown> = {};
      for (const op of ['select', 'insert', 'update', 'eq', 'in']) {
        query[op] = (...args: unknown[]) => {
          calls.push({ op, args });
          return query;
        };
      }
      query.then = (resolve: (value: Answer) => unknown) => resolve(answers.shift() ?? { data: [], error: null });
      return query;
    },
  } as unknown as YouSupabaseClient;
  return { client, calls, tables };
}

const NOW = new Date('2026-10-29T12:00:00Z');

const q = (id: string, extra: Partial<DashQuestion> = {}): DashQuestion => ({
  id,
  question: `Question ${id}`,
  why: null,
  status: 'open',
  answer: null,
  answeredAt: null,
  skippedAt: null,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...extra,
});

describe('splitDashQuestions', () => {
  it('puts open questions first-asked first and past ones latest first', () => {
    const { open, past } = splitDashQuestions([
      q('b', { createdAt: '2026-10-02T00:00:00Z' }),
      q('a', { createdAt: '2026-10-01T00:00:00Z' }),
      q('c', { status: 'skipped', skippedAt: '2026-10-05T00:00:00Z' }),
      q('d', { status: 'answered', answer: 'Yes', answeredAt: '2026-10-07T00:00:00Z' }),
    ]);
    expect(open.map((x) => x.id)).toEqual(['a', 'b']);
    expect(past.map((x) => x.id)).toEqual(['d', 'c']);
  });
});

describe('answerError', () => {
  it('refuses a blank answer and one over the limit', () => {
    expect(answerError('  ')).toMatch(/Write an answer/);
    expect(answerError('x'.repeat(4001))).toMatch(/under 4000/);
    expect(answerError(' Fine ')).toBeNull();
  });
});

describe('loadDashQuestions', () => {
  it('reads only their rows and maps them', async () => {
    const { client, calls, tables } = fakeClient({
      data: [
        {
          id: 'q1',
          question: 'What do you do on a free Saturday?',
          why: 'Your notes say little about rest.',
          status: 'open',
          answer: null,
          answered_at: null,
          skipped_at: null,
          created_at: '2026-10-29T00:00:00Z',
          updated_at: '2026-10-29T00:00:00Z',
        },
      ],
      error: null,
    });
    const { open, past } = await loadDashQuestions(client, 'u1');
    expect(tables).toEqual(['dash_questions']);
    expect(calls).toContainEqual({ op: 'eq', args: ['user_id', 'u1'] });
    expect(open).toEqual([
      expect.objectContaining({ id: 'q1', why: 'Your notes say little about rest.', status: 'open', answer: null }),
    ]);
    expect(past).toEqual([]);
  });

  it('throws when the read fails', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'boom' } });
    await expect(loadDashQuestions(client, 'u1')).rejects.toThrow(/boom/);
  });
});

describe('addDashQuestions', () => {
  it('saves trimmed questions for them, leaving out blanks and ones already open', async () => {
    const { client, calls } = fakeClient(
      { data: [{ question: 'Where do you feel most at home?' }], error: null },
      { data: [{ id: 'n1' }], error: null },
    );
    const ids = await addDashQuestions(client, 'u1', [
      { question: '  What would you do with a free year? ', why: ' You keep mentioning time. ' },
      { question: 'where do you feel most at home?' },
      { question: '   ' },
      { question: 'What would you do with a free year?' },
    ]);
    expect(ids).toEqual(['n1']);
    expect(calls).toContainEqual({ op: 'eq', args: ['status', 'open'] });
    const insert = calls.find((c) => c.op === 'insert');
    expect(insert?.args[0]).toEqual([
      { user_id: 'u1', question: 'What would you do with a free year?', why: 'You keep mentioning time.' },
    ]);
  });

  it('writes nothing when nothing is new', async () => {
    const { client, calls } = fakeClient({ data: [], error: null });
    expect(await addDashQuestions(client, 'u1', [{ question: ' ' }])).toEqual([]);
    expect(calls.some((c) => c.op === 'insert')).toBe(false);
  });
});

describe('answerDashQuestion', () => {
  it('answers an open or skipped question of theirs', async () => {
    const { client, calls } = fakeClient({ data: [{ id: 'q1' }], error: null });
    expect(await answerDashQuestion(client, 'u1', 'q1', '  Reading, mostly. ', NOW)).toEqual({ ok: true });
    expect(calls).toContainEqual({
      op: 'update',
      args: [{ status: 'answered', answer: 'Reading, mostly.', answered_at: NOW.toISOString(), skipped_at: null }],
    });
    expect(calls).toContainEqual({ op: 'eq', args: ['user_id', 'u1'] });
    expect(calls).toContainEqual({ op: 'in', args: ['status', ['open', 'skipped']] });
  });

  it('refuses a blank answer without writing', async () => {
    const { client, calls } = fakeClient();
    expect(await answerDashQuestion(client, 'u1', 'q1', ' ')).toEqual({ ok: false, error: expect.any(String) });
    expect(calls).toEqual([]);
  });

  it('says so when no question of theirs matched', async () => {
    const { client } = fakeClient({ data: [], error: null });
    expect(await answerDashQuestion(client, 'u1', 'q1', 'Yes')).toEqual({
      ok: false,
      error: 'That question is no longer waiting for an answer.',
    });
  });
});

describe('skipDashQuestion', () => {
  it('skips only an open question of theirs', async () => {
    const { client, calls } = fakeClient({ data: [{ id: 'q1' }], error: null });
    expect(await skipDashQuestion(client, 'u1', 'q1', NOW)).toEqual({ ok: true });
    expect(calls).toContainEqual({ op: 'update', args: [{ status: 'skipped', skipped_at: NOW.toISOString() }] });
    expect(calls).toContainEqual({ op: 'eq', args: ['status', 'open'] });
    expect(calls).toContainEqual({ op: 'eq', args: ['user_id', 'u1'] });
  });

  it('reports a failed write', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'boom' } });
    expect(await skipDashQuestion(client, 'u1', 'q1')).toEqual({ ok: false, error: 'Skipping the question failed: boom' });
  });
});

describe('editDashAnswer', () => {
  it('changes only the answer of an answered question of theirs', async () => {
    const { client, calls } = fakeClient({ data: [{ id: 'q1' }], error: null });
    expect(await editDashAnswer(client, 'u1', 'q1', ' Walking now. ')).toEqual({ ok: true });
    expect(calls).toContainEqual({ op: 'update', args: [{ answer: 'Walking now.' }] });
    expect(calls).toContainEqual({ op: 'eq', args: ['status', 'answered'] });
    expect(calls).toContainEqual({ op: 'eq', args: ['user_id', 'u1'] });
  });

  it('says so when the question has no answer yet', async () => {
    const { client } = fakeClient({ data: [], error: null });
    expect(await editDashAnswer(client, 'u1', 'q1', 'Yes')).toEqual({
      ok: false,
      error: 'That question has no answer to change.',
    });
  });
});
