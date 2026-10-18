import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GradeMap } from './grade';

vi.mock('server-only', () => ({}));

const map: GradeMap = {
  topics: [{ id: 't1', name: 'Price elasticity', ceiling: 6, approved: true }],
  cells: [
    { id: 'c1', topicId: 't1', level: 2, descriptor: ['Works out takings from price and quantity'] },
    { id: 'c2', topicId: 't1', level: 3, descriptor: ['Explains why takings rise when demand is inelastic'] },
  ],
  links: [],
  evidence: [],
};

vi.mock('./loader-grade', () => ({
  loadGradeMap: async () => map,
  territoryOf: (userId: string) => `user_id.is.null,user_id.eq.${userId}`,
}));

const gradeCellAnswer = vi.fn();
vi.mock('./grade-call', () => ({
  gradeCellAnswer: (input: unknown) => gradeCellAnswer(input),
  LEVEL_GRADE_MODEL: 'haiku',
  LEVEL_GRADE_SECOND_MODEL: 'second',
}));

const { answerCell, FIGURE_EXACT_GRADER } = await import('./answer-store');

type Op = { method: string; args: unknown[] };
type Call = { table: string; ops: Op[] };

/** A client that records each query and answers it from `reply`. */
function fakeLearn(reply: (call: Call) => { data: unknown; error: null }) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'is', 'in', 'not', 'or', 'order', 'limit', 'update', 'insert']) {
        builder[method] = (...args: unknown[]) => {
          call.ops.push({ method, args });
          return builder;
        };
      }
      const done = () => Promise.resolve(reply(call));
      builder.maybeSingle = done;
      builder.single = done;
      builder.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => done().then(resolve, reject);
      return builder;
    },
  };
  return { client: client as never, calls };
}

const figure = {
  kind: 'table',
  form: 'fill_cell',
  caption: 'A café’s takings before and after a price rise.',
  spec: { columns: ['Price', 'Cups a day', 'Takings'], rows: [['£3.20', '100', '£320'], ['£3.60', '90', '?']] },
  prompt: 'What does the café take in a day at £3.60?',
  answer: '£324',
};

function store(response: string) {
  const writes: { update?: Record<string, unknown>; evidence?: Array<Record<string, unknown>> } = {};
  const fake = fakeLearn((call) => {
    const update = call.ops.find((op) => op.method === 'update');
    const insert = call.ops.find((op) => op.method === 'insert');
    if (call.table === 'cell_questions' && update) {
      writes.update = update.args[0] as Record<string, unknown>;
      return { data: [{ id: 'q1' }], error: null };
    }
    if (call.table === 'cell_questions') {
      return {
        data: { id: 'q1', cell_id: 'c1', question: figure.prompt, expected: null, format: 'figure', figure, answered_at: null },
        error: null,
      };
    }
    if (call.table === 'cell_evidence' && insert) {
      writes.evidence = insert.args[0] as Array<Record<string, unknown>>;
      return {
        data: writes.evidence.map((row, i) => ({ id: `e${i}`, cell_id: row.cell_id, verdict: row.verdict, observed_at: row.observed_at })),
        error: null,
      };
    }
    return { data: [], error: null };
  });
  return { run: () => answerCell(fake.client, 'u1', { questionId: 'q1', response, anthropicApiKey: 'key' }), writes };
}

describe('answering a figure question (plan #2321.5)', () => {
  beforeEach(() => gradeCellAnswer.mockReset());

  it('grades an exact answer itself and writes a met on the asked cell, quoting the answer', async () => {
    const { run, writes } = store('324');
    const result = await run();
    expect(result).toMatchObject({ ok: true, answer: '£324' });
    expect(gradeCellAnswer).not.toHaveBeenCalled();
    expect(writes.update).toMatchObject({ response: '324', model: FIGURE_EXACT_GRADER, grade_second: null });
    expect(writes.evidence).toEqual([expect.objectContaining({ cell_id: 'c1', verdict: 'met', quote: '324', question_id: 'q1' })]);
  });

  it('writes a not met for a plainly wrong answer', async () => {
    const { run, writes } = store('£500');
    expect(await run()).toMatchObject({ ok: true });
    expect(writes.evidence).toEqual([expect.objectContaining({ cell_id: 'c1', verdict: 'not_met', quote: null })]);
  });

  it('sends an answer it cannot call to the model, with the figure, on the asked cell alone', async () => {
    gradeCellAnswer.mockResolvedValue({
      ok: true,
      verdicts: [
        { cell: 'C1', verdict: 'met', quote: 'about £322' },
        { cell: 'C2', verdict: 'met', quote: 'about £322' },
      ],
    });
    const { run, writes } = store('about £322');
    expect(await run()).toMatchObject({ ok: true });
    const input = gradeCellAnswer.mock.calls[0][0] as { cells: Array<{ cellId: string }>; figure: string };
    expect(input.cells.map((cell) => cell.cellId)).toEqual(['c1']);
    expect(input.figure).toContain('The answer: £324');
    // The verdict on a cell the grader was not given is ignored: no more than the asked level.
    expect(writes.evidence).toEqual([expect.objectContaining({ cell_id: 'c1', verdict: 'met' })]);
    expect(writes.update).toMatchObject({ model: 'haiku' });
  });
});
