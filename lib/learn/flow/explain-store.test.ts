import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Answering an explain question in Practice Flow (plan #2164.2), with the
 * teach-back grader stubbed and the rows held in memory. Checked: an
 * explanation is marked, kept on its row, leaves the idea where the mark
 * leaves it and stores one follow-up; "I don't know" is a miss with no
 * marking; the follow-up is marked against what the grader expected, and
 * holding through it marks the idea sharp.
 */

const state = vi.hoisted(() => ({
  probes: [] as Record<string, unknown>[],
  settled: [] as { conceptId: string; state: string }[],
  marked: [] as Record<string, unknown>[],
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/learn/feed/mark-teach-back', () => ({
  TEACH_BACK_MODEL: 'haiku',
  markExplanation: vi.fn(async (input: Record<string, unknown>) => {
    state.marked.push(input);
    return {
      ok: true,
      marking: { holds: true, right: ['the ratio'], missing: ['why it matters'], why: 'Close.', ownExample: false },
      followUp: 'What happens when growth slows?',
      followUpExpected: 'It rises.',
    };
  }),
  markFollowUp: vi.fn(async (input: Record<string, unknown>) => {
    state.marked.push(input);
    return { ok: true, marking: { holds: true, right: ['it rises'], missing: [], why: 'Right.' } };
  }),
}));

vi.mock('@/lib/learn/feed/teach-back-store', () => ({
  settleTeachBackState: vi.fn(async (_l: unknown, _u: string, conceptId: string, settled: string) => {
    state.settled.push({ conceptId, state: settled });
  }),
}));

const { answerExplanation, answerExplainFollowUp } = await import('./explain-store');

const IDEA = { name: 'Burn multiple', claim: 'Net burn over net new ARR.', basis: null };

/** `probes` and `concepts`, enough for reads by id, the guarded update and the insert. */
const supabase = {
  from(table: string) {
    let filters: [string, unknown][] = [];
    let update: Record<string, unknown> | null = null;
    let insert: Record<string, unknown> | null = null;
    const rows = () =>
      state.probes.filter((row) =>
        filters.every(([key, value]) => (value === null ? row[key] == null : row[key] === value)),
      );
    const builder = {
      select: () => builder,
      eq: (key: string, value: unknown) => ((filters = [...filters, [key, value]]), builder),
      is: (key: string, value: unknown) => ((filters = [...filters, [key, value]]), builder),
      update: (values: Record<string, unknown>) => ((update = values), builder),
      insert: (values: Record<string, unknown>) => ((insert = values), builder),
      maybeSingle: async () =>
        table === 'concepts' ? { data: IDEA, error: null } : { data: rows()[0] ?? null, error: null },
      single: async () => {
        const id = `probe-${state.probes.length + 1}`;
        state.probes.push({ id, options: null, answered_at: null, picked_state: null, ...insert });
        return { data: { id }, error: null };
      },
      then: (resolve: (value: unknown) => void) => {
        const hit = rows();
        for (const row of hit) Object.assign(row, update);
        resolve({ data: hit.map((row) => ({ id: row.id })), error: null });
      },
    };
    return builder;
  },
} as never;

beforeEach(() => {
  state.probes = [
    {
      id: 'q1',
      concept_id: 'c1',
      question: 'Explain Burn multiple to a friend.',
      expected: IDEA.claim,
      response: null,
      response_correct: null,
      options: null,
      rung: 'defend',
      answered_at: null,
      picked_state: 'unknown',
    },
  ];
  state.settled = [];
  state.marked = [];
});

const explain = (overrides: Partial<Parameters<typeof answerExplanation>[2]> = {}) =>
  answerExplanation(supabase, 'user-1', {
    probeId: 'q1',
    conceptId: 'c1',
    response: 'It is burn divided by new ARR.',
    dontKnow: false,
    anthropicApiKey: 'key',
    ...overrides,
  });

describe('answerExplanation', () => {
  it('marks the explanation, keeps it, settles the idea and stores the follow-up', async () => {
    const result = await explain();

    expect(result).toMatchObject({
      ok: true,
      value: {
        holds: true,
        right: ['the ratio'],
        missing: ['why it matters'],
        state: 'known',
        followUp: { probeId: 'probe-2', question: 'What happens when growth slows?' },
      },
    });
    expect(state.marked[0]).toMatchObject({ prompt: 'Explain Burn multiple to a friend.' });
    expect(state.probes[0]).toMatchObject({ response: 'It is burn divided by new ARR.', response_correct: true });
    expect(state.probes[0]!.answered_at).toBeTruthy();
    expect(state.probes[1]).toMatchObject({
      concept_id: 'c1',
      rung: 'defend',
      expected: 'It rises.',
      picked_state: null,
    });
    expect(state.settled).toEqual([{ conceptId: 'c1', state: 'known' }]);
  });

  it("counts I don't know as a miss, with no marking and no follow-up", async () => {
    const result = await explain({ dontKnow: true, response: '' });

    expect(result).toMatchObject({
      ok: true,
      value: { holds: false, dontKnow: true, state: 'shaky', claim: IDEA.claim },
    });
    expect(result.ok && result.value.followUp).toBeUndefined();
    expect(state.marked).toHaveLength(0);
    expect(state.probes).toHaveLength(1);
    expect(state.probes[0]).toMatchObject({ dont_know: true, response_correct: false });
    expect(state.settled).toEqual([{ conceptId: 'c1', state: 'shaky' }]);
  });

  it('refuses a question about another idea, or one answered already', async () => {
    expect(await explain({ conceptId: 'c2' })).toMatchObject({ ok: false });
    state.probes[0]!.answered_at = '2026-10-15T00:00:00Z';
    expect(await explain()).toMatchObject({ ok: false, detail: 'That one has been answered already.' });
  });
});

describe('answerExplainFollowUp', () => {
  it('marks the follow-up against what was expected and marks the idea sharp', async () => {
    const first = await explain();
    if (!first.ok || !first.value.followUp) throw new Error('no follow-up');

    const result = await answerExplainFollowUp(supabase, 'user-1', {
      probeId: 'q1',
      followUpId: first.value.followUp.probeId,
      conceptId: 'c1',
      response: 'It gets worse.',
      anthropicApiKey: 'key',
    });

    expect(result).toMatchObject({ ok: true, value: { holds: true, state: 'sharp', claim: IDEA.claim } });
    expect(state.marked[1]).toMatchObject({
      explanation: 'It is burn divided by new ARR.',
      followUp: 'What happens when growth slows?',
      expected: 'It rises.',
    });
    expect(state.probes[1]).toMatchObject({ response: 'It gets worse.', response_correct: true });
    expect(state.settled.at(-1)).toEqual({ conceptId: 'c1', state: 'sharp' });
  });
});
