import { describe, expect, it } from 'vitest';
import { summarize } from './accounts';
import { goalLoanAccounts, sameServicer, type GoalLoanRecord } from './goals-loans';

/** A loans record as Goals keeps it, from the NSLDS file: money in dollars. */
const GRAD_PLUS: GoalLoanRecord = {
  id: 'rec-1',
  data: {
    kind: 'Federal',
    name: 'Grad PLUS 2024–25',
    rate: 9.08,
    as_of: '2026-09-02',
    status: 'Deferred',
    balance: 80080.21,
    due_day: 18,
    minimum: 988,
    next_due: '2026-12-18',
    servicer: 'Edfinancial',
    loan_type: 'Grad PLUS',
  },
  asOf: null,
  updatedAt: '2026-09-25T00:02:38.980Z',
  goalId: 'goal-1',
};

describe('a Goals loan row read as an account', () => {
  it('reads its numbers from the row, in cents', () => {
    const [loan] = goalLoanAccounts([GRAD_PLUS], [], []);
    expect(loan.account).toMatchObject({
      id: 'rec-1',
      name: 'Grad PLUS 2024–25',
      officialName: 'Grad PLUS',
      institutionName: 'Edfinancial',
      kind: 'loan',
      source: 'goals',
      linkId: null,
      interestRate: 9.08,
      minimumPaymentCents: 98_800,
      nextPaymentDueOn: '2026-12-18',
    });
    expect(loan.readings).toEqual([
      { accountId: 'rec-1', readOn: '2026-09-02', balanceCents: 8_008_021 },
    ]);
    expect(loan.goalId).toBe('goal-1');
  });

  it('carries the tracked balances before it as history, with the row as the last word', () => {
    const [loan] = goalLoanAccounts(
      [GRAD_PLUS],
      [
        { recordId: 'rec-1', readOn: '2026-06-02', value: 79000 },
        { recordId: 'rec-1', readOn: '2026-09-02', value: 1 },
        { recordId: 'rec-1', readOn: '2026-09-25', value: 80080.21 },
        { recordId: 'other', readOn: '2026-07-01', value: 5 },
      ],
      [],
    );
    expect(loan.readings.map((r) => [r.readOn, r.balanceCents])).toEqual([
      ['2026-06-02', 7_900_000],
      ['2026-09-02', 8_008_021],
    ]);
  });

  it('is summarised like any account: owed, with a payoff, and stale after 35 days', () => {
    const [loan] = goalLoanAccounts([GRAD_PLUS], [], []);
    const [summary] = summarize([loan.account], loan.readings, [], '2026-10-28');
    expect(summary.balanceCents).toBe(8_008_021);
    expect(summary.payoff?.kind).toBe('on');
    expect(summary.ageDays).toBe(56);
    expect(summary.stale).toBe(true);
  });

  it('falls back to the day the row was saved when it gives no date', () => {
    const [loan] = goalLoanAccounts(
      [{ ...GRAD_PLUS, data: { ...GRAD_PLUS.data, as_of: undefined } }],
      [],
      [],
    );
    expect(loan.readings[0].readOn).toBe('2026-09-25');
  });

  it('shows with no balance when the row has none', () => {
    const [loan] = goalLoanAccounts([{ ...GRAD_PLUS, data: { name: 'Private loan' } }], [], []);
    expect(loan.account.name).toBe('Private loan');
    expect(loan.readings).toEqual([]);
  });

  it('steps aside when Plaid links the servicer, so nothing is counted twice', () => {
    expect(goalLoanAccounts([GRAD_PLUS], [], ['EdFinancial Services'])).toEqual([]);
    expect(goalLoanAccounts([GRAD_PLUS], [], ['Nelnet'])).toHaveLength(1);
  });
});

describe('sameServicer', () => {
  it('matches names that hold one another once punctuation is gone', () => {
    expect(sameServicer('Edfinancial', 'EdFinancial Services')).toBe(true);
    expect(sameServicer('MOHELA', 'Mohela')).toBe(true);
    expect(sameServicer('Nelnet', 'Edfinancial')).toBe(false);
    expect(sameServicer('Ed', 'Edfinancial')).toBe(false);
  });
});
