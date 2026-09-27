import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  canWriteReview,
  checkParagraphs,
  currentYear,
  MIN_EVENTS_TO_WRITE,
  numbersIn,
  parseYear,
  shownNumbers,
  summariseYear,
  yearTotals,
  yearWindow,
} = await import('./year-review');
const { writeYearParagraphs } = await import('./year-review-model');
const { writeYearReviewFor } = await import('./year-review-run');
const { showYearReview } = await import('./year-review-view');
import type { YearReviewPorts, YearReviewRow } from './year-review-run';
import type { RawParagraph, YearReviewRecord } from './year-review';
import { eventRef, type TimelineEvent } from './timeline';

const TZ = 'America/New_York';

let n = 0;
function event(partial: Partial<TimelineEvent> & Pick<TimelineEvent, 'occurred_at' | 'module' | 'kind'>): TimelineEvent {
  n += 1;
  return {
    title: 'Something',
    detail: null,
    amount_cents: null,
    currency: null,
    source_table: 'fixture.rows',
    source_id: `row-${String(n).padStart(4, '0')}`,
    link_ref: null,
    ...partial,
  };
}

const orderMarch = event({
  occurred_at: '2026-03-10T16:00:00Z',
  module: 'shopping',
  kind: 'ordered',
  title: 'Amazon',
  amount_cents: 12050,
  currency: 'USD',
});
const orderMarch2 = event({
  occurred_at: '2026-03-20T16:00:00Z',
  module: 'shopping',
  kind: 'ordered',
  title: 'Amazon',
  amount_cents: 7950,
  currency: 'USD',
});
const orderJune = event({
  occurred_at: '2026-06-02T16:00:00Z',
  module: 'shopping',
  kind: 'ordered',
  title: 'Allbirds',
  amount_cents: 11000,
  currency: 'USD',
});
const refund = event({
  occurred_at: '2026-06-12T16:00:00Z',
  module: 'shopping',
  kind: 'returned',
  title: 'Allbirds',
  amount_cents: 11000,
  currency: 'USD',
});
const step = event({
  occurred_at: '2026-04-01T14:00:00Z',
  module: 'goals',
  kind: 'step_done',
  title: 'Name your target role',
  detail: 'Land your next role',
  link_ref: 'goal-1',
});
// New Year's Eve evening in New York is already 1 January in UTC.
const newYearsEve = event({
  occurred_at: '2027-01-01T03:00:00Z',
  module: 'vault',
  kind: 'note_written',
  title: 'Journal/31 December.md',
});
const applications = Array.from({ length: 24 }, (_, index) =>
  event({
    occurred_at: `2026-0${1 + (index % 6)}-1${index % 10}T15:00:00Z`,
    module: 'jobs',
    kind: 'applied',
    title: `Analyst at Company ${index}`,
  }),
);

const YEAR_EVENTS = [orderMarch, orderMarch2, orderJune, refund, step, newYearsEve, ...applications];

describe('the year on the person’s calendar', () => {
  it('runs from their midnight on 1 January to the next', () => {
    expect(yearWindow(2026, TZ)).toEqual({ from: '2026-01-01T05:00:00.000Z', to: '2027-01-01T05:00:00.000Z' });
  });

  it('reads the current year where they live', () => {
    expect(currentYear(new Date('2027-01-01T03:00:00Z'), TZ)).toBe(2026);
    expect(currentYear(new Date('2027-01-01T03:00:00Z'), 'UTC')).toBe(2027);
  });

  it('opens any year from 2000 to the current one, and nothing else', () => {
    expect(parseYear('2025', 2026)).toBe(2025);
    expect(parseYear('2026', 2026)).toBe(2026);
    expect(parseYear('2027', 2026)).toBeNull();
    expect(parseYear('1999', 2026)).toBeNull();
    expect(parseYear('26', 2026)).toBeNull();
    expect(parseYear(undefined, 2026)).toBeNull();
  });

  it('writes a year until a review is stored after it ended', () => {
    expect(canWriteReview(2026, 2026, null)).toBe(true);
    expect(canWriteReview(2026, 2026, { complete: false })).toBe(true);
    expect(canWriteReview(2025, 2026, { complete: false })).toBe(true);
    expect(canWriteReview(2025, 2026, { complete: true })).toBe(false);
    expect(canWriteReview(2027, 2026, null)).toBe(false);
  });
});

describe('yearTotals', () => {
  const totals = yearTotals(YEAR_EVENTS, 2026, TZ);

  it('counts each kind and the money in and out', () => {
    expect(totals.events).toBe(30);
    expect(totals.kinds).toEqual([
      { kind: 'ordered', count: 3 },
      { kind: 'returned', count: 1 },
      { kind: 'applied', count: 24 },
      { kind: 'note_written', count: 1 },
      { kind: 'step_done', count: 1 },
    ]);
    expect(totals.spent).toEqual([{ currency: 'USD', cents: 31000 }]);
    expect(totals.refunded).toEqual([{ currency: 'USD', cents: 11000 }]);
  });

  it('keeps every month, and puts an event in the month it fell in where they live', () => {
    expect(totals.months.map((month) => month.key)).toEqual([
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
      '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12',
    ]);
    const december = totals.months.find((month) => month.key === '2026-12')!;
    expect(december.modules).toEqual([{ module: 'vault', count: 1 }]);
    const march = totals.months.find((month) => month.key === '2026-03')!;
    expect(march.spent).toEqual([{ currency: 'USD', cents: 20000 }]);
  });

  it('stops at the month given for a year still going', () => {
    expect(yearTotals(YEAR_EVENTS, 2026, TZ, '2026-09').months).toHaveLength(9);
  });

  it('names the shops by spend and the goals by steps', () => {
    expect(totals.shops).toEqual([
      { name: 'Amazon', orders: 2, spent: [{ currency: 'USD', cents: 20000 }] },
      { name: 'Allbirds', orders: 1, spent: [{ currency: 'USD', cents: 11000 }] },
    ]);
    expect(totals.goals).toEqual([{ title: 'Land your next role', ref: 'goal-1', steps: 1 }]);
  });
});

describe('the numbers a paragraph may use', () => {
  const totals = yearTotals(YEAR_EVENTS, 2026, TZ);
  const numbers = shownNumbers(totals);

  it('reads numbers out of prose, amounts included', () => {
    expect(numbersIn('You spent $1,906.41 on 18 orders, 3 of them in May.')).toEqual(['1906.41', '18', '3']);
  });

  it('holds the counts and amounts the page shows, and nothing worked out from them', () => {
    for (const shown of ['2026', '30', '24', '310.00', '310', '200.00', '110.00', '2', '3']) {
      expect(numbers.has(shown), shown).toBe(true);
    }
    expect(numbers.has('200.50')).toBe(false);
    expect(numbers.has('77')).toBe(false);
  });
});

describe('summariseYear', () => {
  const totals = yearTotals(YEAR_EVENTS, 2026, TZ);

  it('gives the model the numbers the page shows, then every event under a short id', () => {
    const { summary, events } = summariseYear(YEAR_EVENTS, totals, {
      timezone: TZ,
      through: '2027-01-01T05:00:00.000Z',
      complete: true,
    });
    expect(summary).toContain('The whole of 2026.');
    expect(summary).toContain('Spent on orders: $310.00');
    expect(summary).toContain('Amazon: 2 orders, $200.00');
    expect(summary).toContain('Land your next role: 1 step');
    expect(events.size).toBe(30);
    const oldest = [...YEAR_EVENTS].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))[0];
    expect(events.get('E1')).toBe(oldest);
    const last = [...events.values()].at(-1)!;
    expect(last).toBe(newYearsEve);
  });

  it('says when the year is not over', () => {
    const { summary } = summariseYear(YEAR_EVENTS, totals, {
      timezone: TZ,
      through: '2026-09-27T12:00:00.000Z',
      complete: false,
    });
    expect(summary).toContain('2026 so far: from 1 January to 2026-09-27. The year is not over.');
  });
});

describe('checkParagraphs', () => {
  const totals = yearTotals(YEAR_EVENTS, 2026, TZ);
  const { events } = summariseYear(YEAR_EVENTS, totals, { timezone: TZ, through: '2027-01-01T05:00:00.000Z', complete: true });
  const idOf = (target: TimelineEvent) => [...events.entries()].find(([, value]) => value === target)![0];
  const numbers = shownNumbers(totals);

  it('keeps a paragraph whose numbers are all on the page and whose rows were sent, in the page’s order', () => {
    const raw: RawParagraph[] = [
      { topic: 'jobs', text: 'You sent 24 applications, most of them in the first half of the year', evidence: [idOf(applications[0]!)] },
      {
        topic: 'shopping',
        text: 'You placed 3 orders for $310.00, 2 of them at Amazon.',
        evidence: [idOf(orderJune), idOf(orderMarch), idOf(orderMarch)],
      },
    ];
    const { kept, dropped } = checkParagraphs(raw, events, numbers);
    expect(dropped).toEqual([]);
    expect(kept.map((paragraph) => paragraph.topic)).toEqual(['shopping', 'jobs']);
    expect(kept[0]!.evidence).toEqual([eventRef(orderMarch), eventRef(orderJune)]);
    expect(kept[1]!.text).toBe('You sent 24 applications, most of them in the first half of the year.');
  });

  it('drops a paragraph with a number the page does not show, or none at all', () => {
    const { kept, dropped } = checkParagraphs(
      [
        { topic: 'shopping', text: 'You spent $155.00 an order on average.', evidence: [idOf(orderMarch)] },
        { topic: 'jobs', text: 'You applied to many roles.', evidence: [idOf(applications[0]!)] },
      ],
      events,
      numbers,
    );
    expect(kept).toEqual([]);
    expect(dropped).toEqual(['unshown-number', 'no-number']);
  });

  it('drops a paragraph citing nothing, or an id that was not sent', () => {
    const { kept, dropped } = checkParagraphs(
      [
        { topic: 'shopping', text: 'You placed 3 orders.', evidence: [] },
        { topic: 'goals', text: 'You closed 1 step.', evidence: ['E999'] },
      ],
      events,
      numbers,
    );
    expect(kept).toEqual([]);
    expect(dropped).toEqual(['unknown-evidence', 'unknown-evidence']);
  });

  it('takes bracketed event ids out of a paragraph, and drops one with an id in its running text', () => {
    const { kept, dropped } = checkParagraphs(
      [
        { topic: 'shopping', text: 'You placed 3 orders (E1-E3), 2 of them at Amazon.', evidence: [idOf(orderMarch)] },
        { topic: 'jobs', text: 'You sent 24 applications, starting with ' + idOf(applications[0]!) + '.', evidence: [idOf(applications[0]!)] },
      ],
      events,
      numbers,
    );
    expect(dropped).toEqual(['event-label']);
    expect(kept.map((paragraph) => paragraph.text)).toEqual(['You placed 3 orders, 2 of them at Amazon.']);
  });

  it('drops an unknown topic and a second paragraph on one topic', () => {
    const { kept, dropped } = checkParagraphs(
      [
        { topic: 'weather', text: 'It rained 3 times.', evidence: [idOf(orderMarch)] },
        { topic: 'shopping', text: 'You placed 3 orders.', evidence: [idOf(orderMarch)] },
        { topic: 'shopping', text: 'You placed 3 orders again.', evidence: [idOf(orderMarch)] },
      ],
      events,
      numbers,
    );
    expect(kept).toHaveLength(1);
    expect(dropped).toEqual(['no-topic', 'repeat-topic']);
  });
});

describe('writeYearParagraphs', () => {
  it('forces the tool, records the spend and returns what came back', async () => {
    const create = vi.fn(async () => ({
      usage: { input_tokens: 100, output_tokens: 20 },
      content: [
        {
          type: 'tool_use',
          name: 'write_year_review',
          input: { paragraphs: [{ topic: 'shopping', text: 'You placed 3 orders.', evidence: ['E1'] }] },
        },
      ],
    }));
    const onSpend = vi.fn();
    const paragraphs = await writeYearParagraphs('summary', {
      apiKey: 'key',
      client: { messages: { create } } as never,
      onSpend,
    });
    expect(paragraphs).toEqual([{ topic: 'shopping', text: 'You placed 3 orders.', evidence: ['E1'] }]);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-5', tool_choice: { type: 'tool', name: 'write_year_review' } }),
    );
    expect(onSpend).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-sonnet-5' }));
  });
});

describe('writeYearReviewFor', () => {
  function ports(over: Partial<YearReviewPorts> = {}) {
    const saved: YearReviewRow[] = [];
    const ledger = vi.fn(async () => {});
    const port: YearReviewPorts = {
      stored: async () => null,
      timeline: async (_user, from, to) => YEAR_EVENTS.filter((row) => row.occurred_at >= from && row.occurred_at < to),
      write: async (summary, onSpend) => {
        onSpend({ model: 'claude-sonnet-5', usage: { input_tokens: 1, output_tokens: 1 } } as never);
        const id = [...summary.matchAll(/^(E\d+) \| .*shopping order/gm)].map((match) => match[1]!);
        return { model: 'claude-sonnet-5', paragraphs: [{ topic: 'shopping', text: 'You placed 3 orders for $310.00.', evidence: id }] };
      },
      ledger,
      save: async (row) => {
        saved.push(row);
      },
      ...over,
    };
    return { port, saved, ledger };
  }
  const input = { userId: 'user-1', year: 2026, timezone: TZ };

  it('writes an ended year whole, as complete', async () => {
    const { port, saved, ledger } = ports();
    const result = await writeYearReviewFor(port, { ...input, now: new Date('2027-01-02T15:23:00Z') });
    expect(result).toEqual({ status: 'written', events: 30, paragraphs: 1, dropped: [] });
    expect(saved[0]).toMatchObject({ year: 2026, complete: true, through: '2027-01-01T05:00:00.000Z', events: 30 });
    expect(saved[0]!.paragraphs[0]!.evidence).toEqual([orderMarch, orderMarch2, orderJune].map(eventRef));
    expect(ledger).toHaveBeenCalledTimes(1);
  });

  it('writes the current year up to now, as not complete', async () => {
    const { port, saved } = ports();
    const result = await writeYearReviewFor(port, { ...input, now: new Date('2026-09-27T12:00:00Z') });
    expect(result.status).toBe('written');
    expect(saved[0]).toMatchObject({ complete: false, through: '2026-09-27T12:00:00.000Z', events: 29 });
    expect(saved[0]!.totals.months).toHaveLength(9);
  });

  it('leaves a review written after its year ended alone', async () => {
    const write = vi.fn();
    const { port, saved } = ports({ stored: async () => ({ complete: true }), write });
    const result = await writeYearReviewFor(port, { ...input, now: new Date('2027-03-01T12:00:00Z') });
    expect(result).toEqual({ status: 'already-complete' });
    expect(write).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });

  it('stores nothing for a year with too little in it, and calls no model', async () => {
    const write = vi.fn();
    const { port, saved } = ports({ timeline: async () => YEAR_EVENTS.slice(0, MIN_EVENTS_TO_WRITE - 1), write });
    const result = await writeYearReviewFor(port, { ...input, year: 2025, now: new Date('2026-09-27T12:00:00Z') });
    expect(result).toEqual({ status: 'too-few', events: MIN_EVENTS_TO_WRITE - 1 });
    expect(write).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });

  it('stores nothing when no paragraph passes, and still records the spend', async () => {
    const { port, saved, ledger } = ports({
      write: async (_summary, onSpend) => {
        onSpend({ model: 'claude-sonnet-5', usage: { input_tokens: 1, output_tokens: 1 } } as never);
        return { model: 'claude-sonnet-5', paragraphs: [{ topic: 'shopping', text: 'You spent a lot.', evidence: ['E1'] }] };
      },
    });
    const result = await writeYearReviewFor(port, { ...input, now: new Date('2027-01-02T15:23:00Z') });
    expect(result).toEqual({ status: 'nothing-kept', dropped: ['no-number'] });
    expect(saved).toEqual([]);
    expect(ledger).toHaveBeenCalledTimes(1);
  });

  it('refuses a year that has not started', async () => {
    const { port } = ports();
    expect(await writeYearReviewFor(port, { ...input, year: 2027, now: new Date('2026-09-27T12:00:00Z') })).toEqual({
      status: 'not-yet',
    });
  });
});

describe('showYearReview', () => {
  const live = yearTotals(YEAR_EVENTS, 2026, TZ);

  it('says what a year without a review holds', () => {
    expect(showYearReview(null, live, YEAR_EVENTS).state).toEqual({ kind: 'unwritten' });
    const few = yearTotals(YEAR_EVENTS.slice(0, 2), 2025, TZ);
    expect(showYearReview(null, few, YEAR_EVENTS.slice(0, 2)).state).toEqual({ kind: 'too-few', events: 2 });
    expect(showYearReview(null, yearTotals([], 2025, TZ), []).state).toEqual({ kind: 'empty' });
  });

  it('shows the stored totals with each paragraph’s rows, and counts what came after', () => {
    const stored: YearReviewRecord = {
      year: 2026,
      through: '2026-06-01T00:00:00.000Z',
      complete: false,
      events: 20,
      totals: yearTotals(YEAR_EVENTS.slice(0, 3), 2026, TZ),
      paragraphs: [
        { topic: 'shopping', text: 'You placed 3 orders.', evidence: [eventRef(orderMarch), 'public.orders:gone'] },
      ],
      model: 'claude-sonnet-5',
      written_at: '2026-06-01T00:00:00.000Z',
    };
    const shown = showYearReview(stored, live, YEAR_EVENTS);
    expect(shown.totals).toBe(stored.totals);
    expect(shown.paragraphs[0]!.events).toEqual([orderMarch]);
    expect(shown.state).toMatchObject({ kind: 'written', eventsThen: 20, complete: false });
    const after = YEAR_EVENTS.filter((row) => row.occurred_at >= stored.through).length;
    expect(shown.state).toMatchObject({ eventsSince: after });
  });
});
