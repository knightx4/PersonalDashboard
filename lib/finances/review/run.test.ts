import { describe, expect, it } from 'vitest';
import type { SpendReport } from '@/lib/core/spend/pricing';
import type { MonthFacts } from './facts';
import { MAX_ATTEMPTS, runMonthReviewFor, type ExistingReview, type MonthReviewPorts, type MonthReviewRow } from './run';
import type { RawWording } from './write';

const facts: MonthFacts = {
  month: '2026-10',
  label: 'October 2026',
  plainSummary: 'In October you spent $400.00.',
  facts: [
    {
      id: 'spending',
      kind: 'spending',
      plain: 'You spent $400.00 in October across 2 charges.',
      figures: { spent: '$400.00', charges: '2' },
      transactionIds: ['t1', 't2'],
      accountIds: [],
    },
  ],
};
const empty: MonthFacts = { ...facts, facts: [], plainSummary: 'Nothing came through your accounts in October, so there is nothing to review.' };

const report: SpendReport = { model: 'claude-sonnet-5-5', usage: { inputTokens: 1, outputTokens: 1 } } as SpendReport;

function ports(over: {
  existing?: ExistingReview | null;
  facts?: MonthFacts | null | Error;
  word?: RawWording | null | Error | 'no-key';
}) {
  const saved: MonthReviewRow[] = [];
  const ledger: SpendReport[] = [];
  let worded = 0;
  const p: MonthReviewPorts = {
    async existing() {
      return over.existing ?? null;
    },
    async facts() {
      if (over.facts instanceof Error) throw over.facts;
      return over.facts === undefined ? facts : over.facts;
    },
    async word(_facts, onSpend) {
      worded += 1;
      if (over.word === 'no-key') return null;
      onSpend(report);
      if (over.word instanceof Error) throw over.word;
      return { model: 'claude-sonnet-5-5', wording: over.word ?? null };
    },
    async ledger(_userId, r) {
      ledger.push(r);
    },
    async save(row) {
      saved.push(row);
    },
  };
  return { p, saved, ledger, worded: () => worded };
}

const run = (p: MonthReviewPorts, force = false) =>
  runMonthReviewFor(p, 'u1', { month: '2026-10', today: '2026-11-01', now: new Date('2026-11-01T12:00:00Z'), force });

describe('runMonthReviewFor', () => {
  it("stores Dash's wording with every line's transactions, and records the spend", async () => {
    const t = ports({ word: { summary: 'October cost $400.00.', lines: [{ fact: 'spending', text: 'You spent $400.00 on 2 charges.' }] } });
    expect(await run(t.p)).toEqual({ status: 'written', source: 'model', lines: 1, dropped: 0 });
    expect(t.saved).toHaveLength(1);
    expect(t.saved[0]).toMatchObject({
      user_id: 'u1',
      month: '2026-10-01',
      status: 'written',
      source: 'model',
      model: 'claude-sonnet-5-5',
      summary: 'October cost $400.00.',
      attempts: 1,
      error: null,
      written_at: '2026-11-01T12:00:00.000Z',
    });
    expect(t.saved[0].lines[0]).toMatchObject({ text: 'You spent $400.00 on 2 charges.', transaction_ids: ['t1', 't2'] });
    expect(t.ledger).toEqual([report]);
  });

  it('writes a month once', async () => {
    const t = ports({ existing: { status: 'written', source: 'model', attempts: 1, lineCount: 3 } });
    expect(await run(t.p)).toEqual({ status: 'already-written' });
    expect(t.saved).toEqual([]);
    expect(t.worded()).toBe(0);
  });

  it('writes nothing for a person with no accounts', async () => {
    const t = ports({ facts: null });
    expect(await run(t.p)).toEqual({ status: 'no-accounts' });
    expect(t.saved).toEqual([]);
  });

  it('stores a month with nothing in it without a model call, and writes it again once facts turn up', async () => {
    const quiet = ports({ facts: empty });
    expect(await run(quiet.p)).toEqual({ status: 'written', source: 'plain', lines: 0, dropped: 0 });
    expect(quiet.worded()).toBe(0);
    expect(quiet.saved[0]).toMatchObject({ status: 'written', source: 'plain', lines: [], summary: empty.plainSummary });

    const stillQuiet = ports({ facts: empty, existing: { status: 'written', source: 'plain', attempts: 1, lineCount: 0 } });
    expect(await run(stillQuiet.p)).toEqual({ status: 'unchanged' });
    expect(stillQuiet.saved).toEqual([]);

    const later = ports({ existing: { status: 'written', source: 'plain', attempts: 1, lineCount: 0 }, word: 'no-key' });
    expect(await run(later.p)).toMatchObject({ status: 'written', lines: 1 });
    expect(later.saved[0]).toMatchObject({ attempts: 2, source: 'plain' });
  });

  it('stores the plain sentences without a key', async () => {
    const t = ports({ word: 'no-key' });
    expect(await run(t.p)).toEqual({ status: 'written', source: 'plain', lines: 1, dropped: 0 });
    expect(t.saved[0]).toMatchObject({ source: 'plain', model: null, summary: facts.plainSummary });
    expect(t.ledger).toEqual([]);
  });

  it('leaves a failed row the page can retry from when the model call fails, and still records its spend', async () => {
    const t = ports({ word: new Error('overloaded') });
    expect(await run(t.p)).toEqual({ status: 'failed', error: 'overloaded' });
    expect(t.saved[0]).toMatchObject({ status: 'failed', source: null, error: 'overloaded', attempts: 1, written_at: null });
    expect(t.saved[0].lines.map((l) => l.text)).toEqual([facts.facts[0].plain]);
    expect(t.ledger).toEqual([report]);
  });

  it('records a failure reading the facts', async () => {
    const t = ports({ facts: new Error('Reading accounts failed: timeout') });
    expect(await run(t.p)).toEqual({ status: 'failed', error: 'Reading accounts failed: timeout' });
    expect(t.saved[0]).toMatchObject({ status: 'failed', lines: [], error: 'Reading accounts failed: timeout' });
  });

  it('retries a failed month on its own until the attempts run out, and on Try again after that', async () => {
    const failed = (attempts: number): ExistingReview => ({ status: 'failed', source: null, attempts, lineCount: 1 });
    const again = ports({ existing: failed(1), word: 'no-key' });
    expect(await run(again.p)).toMatchObject({ status: 'written' });
    expect(again.saved[0].attempts).toBe(2);

    const spent = ports({ existing: failed(MAX_ATTEMPTS) });
    expect(await run(spent.p)).toEqual({ status: 'gave-up', attempts: MAX_ATTEMPTS });
    expect(spent.saved).toEqual([]);

    const button = ports({ existing: failed(MAX_ATTEMPTS), word: 'no-key' });
    expect(await run(button.p, true)).toMatchObject({ status: 'written' });
    expect(button.saved[0].attempts).toBe(MAX_ATTEMPTS + 1);
  });

  it('keeps a written review when a forced run fails', async () => {
    const t = ports({ existing: { status: 'written', source: 'model', attempts: 1, lineCount: 2 }, word: new Error('down') });
    expect(await run(t.p, true)).toEqual({ status: 'failed', error: 'down' });
    expect(t.saved).toEqual([]);
  });
});
