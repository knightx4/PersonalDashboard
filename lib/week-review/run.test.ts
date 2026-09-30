import { describe, expect, it, vi } from 'vitest';
import type { SpendReport } from '@/lib/core/spend/pricing';
import type { WeekFacts } from './facts';
import { WEEK_REVIEW_MODEL, writeWeekReview } from './model';
import { runWeekReviewFor, type WeekReviewPorts, type WeekReviewRow } from './run';

const USER = 'u1';
const SUNDAY_MORNING = new Date('2026-09-27T13:10:00Z'); // 09:10 in New York
const REPORT = {
  model: WEEK_REVIEW_MODEL,
  usage: { inputTokens: 20_000, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 900 },
} as SpendReport;

const FACTS: WeekFacts = {
  week: '2026-09-20',
  timezone: 'America/New_York',
  from: '2026-09-20T04:00:00.000Z',
  to: '2026-09-27T04:00:00.000Z',
  previousFrom: 'review',
  facts: [
    {
      id: 'jobs.applied',
      module: 'jobs',
      label: 'applications sent',
      value: 4,
      previous: 7,
      currency: null,
      goalIds: ['goal-job'],
      evidence: ['jobs.applications:a1'],
    },
    {
      id: 'vault.notes',
      module: 'vault',
      label: 'notes written',
      value: 5,
      previous: 2,
      currency: null,
      goalIds: [],
      evidence: ['vault.notes:n1'],
    },
    {
      id: 'todo.tasks',
      module: 'todo',
      label: 'tasks done',
      value: 9,
      previous: 9,
      currency: null,
      goalIds: [],
      evidence: ['todo.tasks:t1'],
    },
  ],
  stalled: [],
  goals: [{ id: 'goal-job', title: 'Find a product role' }],
};

const REPLY = {
  observations: [
    { text: 'You sent 4 applications against 7 the week before.', facts: ['jobs.applied'], goal: 'G1' },
    { text: 'You wrote 5 notes, up from 2.', facts: ['vault.notes'] },
    { text: 'You finished 9 tasks, as many as the week before.', facts: ['todo.tasks'] },
  ],
  change: 'Send 7 applications again, one each morning.',
  last_change: 'not_kept',
};

/** A stand-in Anthropic client that answers with the forced tool call. */
function stubClient(input: unknown) {
  return {
    messages: {
      create: vi.fn(async () => ({
        content: [{ type: 'tool_use', id: 't1', name: 'write_week_review', input }],
        usage: { input_tokens: 20_000, output_tokens: 900 },
      })),
    },
  } as unknown as Parameters<typeof writeWeekReview>[1]['client'] & { messages: { create: ReturnType<typeof vi.fn> } };
}

function ports(overrides: Partial<WeekReviewPorts> = {}, client = stubClient(REPLY)) {
  const saved: WeekReviewRow[] = [];
  const base: WeekReviewPorts = {
    hasReview: vi.fn(async () => saved.length > 0),
    facts: vi.fn(async () => FACTS),
    previous: vi.fn(async () => ({ change: 'Send 7 applications.', observations: ['You sent 7 applications.'] })),
    homeSaid: vi.fn(async () => []),
    write: vi.fn(async (input, onSpend) => ({
      model: WEEK_REVIEW_MODEL,
      review: await writeWeekReview(input, { apiKey: 'test', client, onSpend }),
    })),
    ledger: vi.fn(async () => undefined),
    save: vi.fn(async (row) => {
      if (saved.some((earlier) => earlier.week === row.week)) return false;
      saved.push(row);
      return true;
    }),
    written: vi.fn(async () => undefined),
  };
  return { ports: { ...base, ...overrides }, saved, client };
}

describe('runWeekReviewFor', () => {
  it('does nothing before 9am on Sunday', async () => {
    const { ports: p } = ports();
    expect(await runWeekReviewFor(p, USER, new Date('2026-09-27T12:30:00Z'))).toEqual({ status: 'not-due' });
    expect(p.hasReview).not.toHaveBeenCalled();
  });

  it("stores Dash's review with its facts, records the spend, then hands the row on", async () => {
    const { ports: p, saved, client } = ports();
    const result = await runWeekReviewFor(p, USER, SUNDAY_MORNING);
    expect(result).toEqual({ status: 'written', week: '2026-09-20', source: 'model', observations: 3, dropped: [] });
    expect(client.messages.create).toHaveBeenCalledTimes(1);
    expect(p.previous).toHaveBeenCalledWith(USER, '2026-09-13');

    const row = saved[0]!;
    expect(row).toMatchObject({
      user_id: USER,
      week: '2026-09-20',
      timezone: 'America/New_York',
      facts: FACTS,
      change: 'Send 7 applications again, one each morning.',
      change_kept: false,
      source: 'model',
      model: WEEK_REVIEW_MODEL,
    });
    expect(row.observations).toHaveLength(3);
    expect(row.observations[0]).toEqual({
      text: 'You sent 4 applications against 7 the week before.',
      goal_id: 'goal-job',
      evidence: ['jobs.applications:a1'],
      facts: ['jobs.applied'],
    });
    // Every number written is a figure of the facts.
    const figures = new Set(FACTS.facts.flatMap((fact) => [String(fact.value), String(fact.previous)]));
    for (const text of [...row.observations.map((item) => item.text), row.change!]) {
      for (const number of text.match(/\d+/g) ?? []) expect(figures).toContain(number);
    }
    expect(p.ledger).toHaveBeenCalledWith(USER, expect.objectContaining({ model: WEEK_REVIEW_MODEL }));
    expect(p.written).toHaveBeenCalledWith(row);
  });

  it('makes no model call and stores nothing the second time in a week', async () => {
    const { ports: p, saved, client } = ports();
    await runWeekReviewFor(p, USER, SUNDAY_MORNING);
    const again = await runWeekReviewFor(p, USER, new Date('2026-09-27T14:10:00Z'));
    expect(again).toEqual({ status: 'already-written', week: '2026-09-20' });
    expect(client.messages.create).toHaveBeenCalledTimes(1);
    expect(p.save).toHaveBeenCalledTimes(1);
    expect(saved).toHaveLength(1);
  });

  it('stores the plain version when the call fails, still recording what it cost', async () => {
    const { ports: p, saved } = ports({
      write: vi.fn(async (_input, onSpend) => {
        onSpend(REPORT);
        throw new Error('overloaded');
      }),
    });
    const result = await runWeekReviewFor(p, USER, SUNDAY_MORNING);
    expect(result).toMatchObject({ status: 'written', source: 'plain' });
    expect(saved[0]).toMatchObject({ source: 'plain', model: null, change_kept: null });
    expect(saved[0]!.observations.map((item) => item.text)).toEqual([
      'Applications sent: 4 this week, against 7 the week before.',
      'Notes written: 5 this week, against 2 the week before.',
      'Tasks done: 9 this week, against 9 the week before.',
    ]);
    expect(p.ledger).toHaveBeenCalledWith(USER, REPORT);
  });

  it('stores the plain version without a key', async () => {
    const { ports: p, saved } = ports({ write: vi.fn(async () => null) });
    await runWeekReviewFor(p, USER, SUNDAY_MORNING);
    expect(saved[0]).toMatchObject({ source: 'plain', model: null });
  });

  it('stores the plain version when nothing the model wrote passes the checks', async () => {
    const client = stubClient({
      observations: [{ text: 'You sent 3 fewer applications.', facts: ['jobs.applied'] }],
      change: 'Apply more.',
      last_change: 'kept',
    });
    const { ports: p, saved } = ports({}, client);
    const result = await runWeekReviewFor(p, USER, SUNDAY_MORNING);
    expect(result).toMatchObject({ source: 'plain', dropped: ['number-not-in-facts'] });
    expect(saved[0]?.source).toBe('plain');
  });

  it('asks no model on a week with nothing counted', async () => {
    const quiet: WeekFacts = {
      ...FACTS,
      facts: FACTS.facts.map((fact) => ({ ...fact, value: 0, previous: 0, evidence: [] })),
    };
    const { ports: p, saved } = ports({ facts: vi.fn(async () => quiet) });
    await runWeekReviewFor(p, USER, SUNDAY_MORNING);
    expect(p.write).not.toHaveBeenCalled();
    expect(saved[0]).toMatchObject({ source: 'plain', observations: [], change: null });
  });

  it('does not hand the row on when another call stored the week first', async () => {
    const { ports: p } = ports({ save: vi.fn(async () => false) });
    expect(await runWeekReviewFor(p, USER, SUNDAY_MORNING)).toEqual({ status: 'already-written', week: '2026-09-20' });
    expect(p.written).not.toHaveBeenCalled();
  });
});
