import { describe, expect, it } from 'vitest';
import { accountTitle } from '@/lib/finances/accounts';
import { reviewStartsOpen } from './seen';
import {
  CHARGES_SHOWN,
  firstReview,
  reviewLabel,
  showReview,
  storedLines,
  type MonthReviewRecord,
  type ReviewCharge,
} from './show';

const record = (extra: Partial<MonthReviewRecord> = {}): MonthReviewRecord => ({
  id: 'r1',
  month: '2026-10-01',
  status: 'written',
  summary: 'You spent $2,140.00 in October.',
  lines: [],
  facts: { label: 'October 2026' },
  attempts: 1,
  ...extra,
});

const charge = (id: string, amountCents: number, postedOn = '2026-10-10'): ReviewCharge => ({
  id,
  accountId: 'a1',
  postedOn,
  name: id,
  amountCents,
  pending: false,
});

describe('showReview', () => {
  it('keeps the stored order and links each line to what is behind it', () => {
    const charges = new Map(
      Array.from({ length: 10 }, (_, i) => charge(`t${i}`, -(i + 1) * 100)).map((c) => [c.id, c]),
    );
    const shown = showReview(
      record({
        lines: [
          {
            id: 'spending',
            kind: 'spending',
            text: 'You spent more.',
            transaction_ids: [...charges.keys(), 'gone'],
            account_ids: [],
          },
          {
            id: 'due:a2',
            kind: 'due',
            text: 'Your card is due.',
            transaction_ids: [],
            account_ids: ['a2', 'missing'],
          },
        ],
      }),
      charges,
      new Map([['a2', { id: 'a2', name: 'Sapphire', mask: '4417' }]]),
    );
    expect(shown.state).toBe('written');
    expect(shown.label).toBe('October 2026');
    expect(shown.month).toBe('2026-10');
    expect(shown.lines.map((l) => l.id)).toEqual(['spending', 'due:a2']);
    const [spending, due] = shown.lines;
    expect(spending.chargeCount).toBe(10);
    expect(spending.charges).toHaveLength(CHARGES_SHOWN);
    expect(spending.charges[0].id).toBe('t9');
    expect(spending.totalCents).toBe(-5_500);
    expect(due.chargeCount).toBe(0);
    expect(due.accounts).toEqual([
      { id: 'a2', title: accountTitle({ name: 'Sapphire', mask: '4417' }) },
    ]);
  });

  it('tells a quiet month and a failed run apart', () => {
    expect(showReview(record(), new Map(), new Map()).state).toBe('quiet');
    const failed = showReview(record({ status: 'failed', attempts: 3 }), new Map(), new Map());
    expect(failed.state).toBe('failed');
    expect(failed.gaveUp).toBe(true);
    expect(showReview(record({ status: 'failed', attempts: 1 }), new Map(), new Map()).gaveUp).toBe(
      false,
    );
  });
});

describe('storedLines', () => {
  it('drops lines not in the stored shape', () => {
    expect(storedLines([null, { id: 'x' }, { id: 'y', kind: 'spending', text: ' ' }])).toEqual([]);
    expect(storedLines('nope')).toEqual([]);
  });
});

describe('reviewLabel', () => {
  it('falls back to the month when the facts have no label', () => {
    expect(reviewLabel({ month: '2026-09-01', facts: {} })).toBe('September 2026');
  });
});

describe('firstReview', () => {
  it('names the month and the first of the next', () => {
    expect(firstReview('2026-10-28')).toEqual({ label: 'October 2026', on: '2026-11-01' });
    expect(firstReview('2026-12-05')).toEqual({ label: 'December 2026', on: '2027-01-01' });
  });
});

describe('reviewStartsOpen', () => {
  it('opens a month not yet seen on this device', () => {
    expect(reviewStartsOpen('2026-10', undefined)).toBe(true);
    expect(reviewStartsOpen('2026-10', '2026-09')).toBe(true);
    expect(reviewStartsOpen('2026-10', '2026-10')).toBe(false);
  });
});
