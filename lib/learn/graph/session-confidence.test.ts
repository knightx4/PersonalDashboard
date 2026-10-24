import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { recordAnswer, recordWrittenAnswer } from './session';

/**
 * What an answer does to its idea once how sure you were and how you
 * reasoned are read (plan #2522.3), on the probe path. The client records
 * every write, so the test reads what reached the database.
 */

type Write = { table: string; op: 'update' | 'upsert'; values: Record<string, unknown> };

function fakeLearn(row: Record<string, unknown>) {
  const writes: Write[] = [];
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    for (const method of ['select', 'eq', 'in', 'is', 'order', 'limit']) builder[method] = chain;
    builder.maybeSingle = async () => ({ data: row, error: null });
    builder.update = (values: Record<string, unknown>) => {
      writes.push({ table, op: 'update', values });
      return builder;
    };
    builder.upsert = (values: Record<string, unknown>) => {
      writes.push({ table, op: 'upsert', values });
      return builder;
    };
    builder.then = (resolve: (v: { data: null; error: null }) => void) => resolve({ data: null, error: null });
    return builder;
  };
  return { client: { from } as never, writes };
}

const stateWrites = (writes: Write[]) => writes.filter((w) => w.table === 'concept_state' && w.op === 'upsert');
const answerWrite = (writes: Write[]) => writes.find((w) => w.table === 'probes' && w.op === 'update')?.values;

const caseRow = { response: null, mastery_check: null, rung: 'apply' };
const written = (correct: boolean, signals: { confidence?: number | null; reasoning?: string | null }) => ({
  probeId: 'p1',
  conceptId: 'c1',
  response: 'Pay barely moves.',
  correct,
  why: correct ? 'Same mechanism.' : 'Wrong mechanism.',
  wasSettled: false,
  signals,
});

describe('a written answer, read with how sure you were', () => {
  it('leaves the idea where it was when right at Guessing, and keeps the answer', async () => {
    const { client, writes } = fakeLearn(caseRow);
    const outcome = await recordWrittenAnswer(client, 'u1', written(true, { confidence: 0.25 }));

    expect(outcome.correct).toBe(true);
    expect(outcome.guessed).toBe(true);
    expect(outcome.state).toBeNull();
    expect(stateWrites(writes)).toHaveLength(0);
    expect(answerWrite(writes)).toMatchObject({ response_correct: true, confidence: 0.25 });
  });

  it('moves the idea when right with any other confidence', async () => {
    const { client, writes } = fakeLearn(caseRow);
    const outcome = await recordWrittenAnswer(client, 'u1', written(true, { confidence: 0.75, reasoning: 'Contracts.' }));

    expect(outcome.state).toBe('known');
    expect(stateWrites(writes)[0].values).toMatchObject({ state: 'known', established: 'tested' });
    expect(answerWrite(writes)).toMatchObject({ confidence: 0.75, reasoning: 'Contracts.' });
  });

  it('writes a wrong answer at Certain as a misconception candidate', async () => {
    const { client, writes } = fakeLearn(caseRow);
    const outcome = await recordWrittenAnswer(client, 'u1', written(false, { confidence: 0.95 }));

    expect(outcome.misconceptionCandidate).toBe(true);
    expect(outcome.state).toBe('shaky');
    expect(answerWrite(writes)).toMatchObject({ miss_kind: 'misconception' });
  });

  it('answers exactly as before when nothing came with it', async () => {
    const { client, writes } = fakeLearn(caseRow);
    const outcome = await recordWrittenAnswer(client, 'u1', written(true, {}));

    expect(outcome.state).toBe('known');
    expect(answerWrite(writes)).not.toHaveProperty('confidence');
    expect(answerWrite(writes)).not.toHaveProperty('miss_kind');
  });
});

describe('a picked answer, read with its reasoning', () => {
  const pickRow = { correct_index: 1, reason: 'B is the claim.', chosen_index: null, dont_know: false, mastery_check: null };

  it('is wrong when the reasoning contradicts a right pick, with the grader’s sentence as the reason', async () => {
    const { client, writes } = fakeLearn(pickRow);
    const outcome = await recordAnswer(client, 'u1', {
      probeId: 'p1',
      conceptId: 'c1',
      chosenIndex: 1,
      wasSettled: false,
      signals: { confidence: 0.95, reasoning: 'Because prices are sticky.' },
      reasoningWrong: 'Prices are not the reason; pay is.',
    });

    expect(outcome.correct).toBe(false);
    expect(outcome.reason).toBe('Prices are not the reason; pay is.');
    expect(outcome.misconceptionCandidate).toBe(true);
    expect(stateWrites(writes)[0].values).toMatchObject({ state: 'shaky' });
  });

  it('leaves the idea where it was on a right guess', async () => {
    const { client, writes } = fakeLearn(pickRow);
    const outcome = await recordAnswer(client, 'u1', {
      probeId: 'p1',
      conceptId: 'c1',
      chosenIndex: 1,
      wasSettled: false,
      signals: { confidence: 0.25 },
    });

    expect(outcome.correct).toBe(true);
    expect(outcome.guessed).toBe(true);
    expect(stateWrites(writes)).toHaveLength(0);
  });
});
