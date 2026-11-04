import { describe, expect, it } from 'vitest';
import {
  ageLabel,
  dueSoon,
  freshness,
  grouped,
  investmentValue,
  limitUsed,
  loanPayoff,
  netWorthChange,
  netWorthNow,
  netWorthSeries,
  summarize,
  type AccountRow,
  type Holding,
  type Reading,
} from './accounts';

const TODAY = '2026-10-28';

function account(
  id: string,
  kind: AccountRow['kind'],
  extra: Partial<AccountRow> = {},
): AccountRow {
  return {
    id,
    name: id,
    officialName: null,
    institutionName: null,
    mask: null,
    kind,
    source: 'plaid',
    linkId: null,
    creditLimitCents: null,
    interestRate: null,
    minimumPaymentCents: null,
    nextPaymentDueOn: null,
    statementBalanceCents: null,
    closedOn: null,
    ...extra,
  };
}

const reading = (accountId: string, readOn: string, balanceCents: number): Reading => ({
  accountId,
  readOn,
  balanceCents,
});

describe('freshness', () => {
  it('calls a linked balance stale after a day and an imported one after 35', () => {
    expect(freshness('plaid', '2026-10-27', TODAY)).toEqual({ ageDays: 1, stale: false });
    expect(freshness('plaid', '2026-10-26', TODAY)).toEqual({ ageDays: 2, stale: true });
    expect(freshness('import', '2026-09-23', TODAY)).toEqual({ ageDays: 35, stale: false });
    expect(freshness('import', '2026-09-22', TODAY).stale).toBe(true);
    expect(freshness('manual', null, TODAY)).toEqual({ ageDays: null, stale: true });
  });

  it('says the age in words', () => {
    expect(ageLabel(0)).toBe('Today');
    expect(ageLabel(1)).toBe('Yesterday');
    expect(ageLabel(5)).toBe('5 days old');
    expect(ageLabel(20)).toBe('2 weeks old');
    expect(ageLabel(90)).toBe('3 months old');
  });
});

describe('loanPayoff', () => {
  it('pays a loan off at its payment, counting from next month', () => {
    // $10,000 at 6% with $200 a month: 58 payments.
    expect(loanPayoff(1_000_000, 6, 20_000, TODAY)).toEqual({
      kind: 'on',
      months: 58,
      month: '2031-08',
    });
  });

  it('divides when there is no interest', () => {
    expect(loanPayoff(100_000, 0, 30_000, TODAY)).toEqual({
      kind: 'on',
      months: 4,
      month: '2027-02',
    });
  });

  it('never pays off when the payment does not cover the interest', () => {
    expect(loanPayoff(1_000_000, 12, 10_000, TODAY)).toEqual({ kind: 'never' });
  });

  it('needs a balance and a payment', () => {
    expect(loanPayoff(null, 5, 100, TODAY)).toBeNull();
    expect(loanPayoff(100, 5, null, TODAY)).toBeNull();
    expect(loanPayoff(0, 5, 100, TODAY)).toEqual({ kind: 'paid' });
  });
});

describe('cards and brokerage', () => {
  it('works out how much of a limit is used', () => {
    expect(limitUsed(250_000, 1_000_000)).toBe(0.25);
    expect(limitUsed(-500, 1_000_000)).toBe(0);
    expect(limitUsed(500, null)).toBeNull();
  });

  it('values the newest holdings and counts gain only where the cost is known', () => {
    const holdings: Holding[] = [
      {
        accountId: 'b',
        securityName: 'Old',
        ticker: 'OLD',
        quantity: 1,
        valueCents: 999,
        costBasisCents: 1,
        asOf: '2026-10-01',
      },
      {
        accountId: 'b',
        securityName: 'Fund',
        ticker: 'VTI',
        quantity: 10,
        valueCents: 300_000,
        costBasisCents: 250_000,
        asOf: '2026-10-27',
      },
      {
        accountId: 'b',
        securityName: 'Cash',
        ticker: null,
        quantity: 1,
        valueCents: 5_000,
        costBasisCents: null,
        asOf: '2026-10-27',
      },
    ];
    expect(investmentValue(holdings)).toEqual({
      valueCents: 305_000,
      costCents: 250_000,
      gainCents: 50_000,
      asOf: '2026-10-27',
    });
  });
});

describe('net worth', () => {
  const accounts = [
    account('chk', 'checking'),
    account('card', 'credit_card'),
    account('loan', 'loan'),
  ];
  const readings = [
    reading('chk', '2026-10-25', 500_000),
    reading('card', '2026-10-25', 100_000),
    reading('loan', '2026-10-26', 2_000_000),
    reading('chk', '2026-10-27', 450_000),
  ];

  it('subtracts cards and loans and carries each balance forward', () => {
    expect(netWorthSeries(accounts, readings, TODAY)).toEqual([
      { day: '2026-10-25', cents: 400_000 },
      { day: '2026-10-26', cents: -1_600_000 },
      { day: '2026-10-27', cents: -1_650_000 },
      { day: '2026-10-28', cents: -1_650_000 },
    ]);
  });

  it('starts inside the window with the balances read before it', () => {
    const series = netWorthSeries(accounts, readings, TODAY, 2);
    expect(series).toEqual([
      { day: '2026-10-27', cents: -1_650_000 },
      { day: '2026-10-28', cents: -1_650_000 },
    ]);
  });

  it('drops an account after the day it closed', () => {
    const closed = [
      account('chk', 'checking'),
      account('sav', 'savings', { closedOn: '2026-10-26' }),
    ];
    const series = netWorthSeries(
      closed,
      [reading('chk', '2026-10-26', 100), reading('sav', '2026-10-26', 50)],
      '2026-10-27',
    );
    expect(series.map((p) => p.cents)).toEqual([150, 100]);
  });

  it('says how it moved and what it is now', () => {
    const series = netWorthSeries(accounts, readings, TODAY);
    expect(netWorthChange(series, 30)).toEqual({ cents: -2_050_000, since: '2026-10-25' });
    const summaries = summarize(accounts, readings, [], TODAY);
    expect(netWorthNow(summaries)).toBe(450_000 - 100_000 - 2_000_000);
  });
});

describe('summarize and grouped', () => {
  it('groups cash, cards, investments and loans with each kind’s figures', () => {
    const accounts = [
      account('card', 'credit_card', { creditLimitCents: 1_000_000 }),
      account('sav', 'savings', { source: 'import' }),
      account('chk', 'checking'),
      account('loan', 'loan', { source: 'goals', interestRate: 0, minimumPaymentCents: 50_000 }),
      account('brk', 'brokerage'),
    ];
    const readings = [
      reading('card', '2026-10-28', 200_000),
      reading('sav', '2026-08-01', 1_000_000),
      reading('chk', '2026-10-28', 300_000),
      reading('loan', '2026-10-20', 100_000),
    ];
    const holdings: Holding[] = [
      {
        accountId: 'brk',
        securityName: 'Fund',
        ticker: 'VTI',
        quantity: 1,
        valueCents: 700_000,
        costBasisCents: 600_000,
        asOf: '2026-10-27',
      },
    ];
    const summaries = summarize(accounts, readings, holdings, TODAY, new Map([['chk', 2]]));
    const groups = grouped(summaries);
    expect(groups.map((g) => [g.id, g.accounts.map((a) => a.id), g.totalCents])).toEqual([
      ['cash', ['sav', 'chk'], 1_300_000],
      ['cards', ['card'], 200_000],
      ['investments', ['brk'], 700_000],
      ['loans', ['loan'], 100_000],
    ]);
    const byId = new Map(summaries.map((s) => [s.id, s]));
    expect(byId.get('card')!.limitUsed).toBe(0.2);
    expect(byId.get('sav')!.stale).toBe(true);
    expect(byId.get('loan')!.payoff).toEqual({ kind: 'on', months: 2, month: '2026-12' });
    expect(byId.get('brk')!.balanceCents).toBe(700_000);
    expect(byId.get('brk')!.investment?.gainCents).toBe(100_000);
    expect(byId.get('chk')!.comments).toBe(2);
  });
});

describe('dueSoon', () => {
  const summaries = summarize(
    [
      account('card-soon', 'credit_card', { nextPaymentDueOn: '2026-11-03', statementBalanceCents: 21_180, minimumPaymentCents: 3_500 }),
      account('card-first', 'credit_card', { nextPaymentDueOn: '2026-10-31', minimumPaymentCents: 2_500 }),
      account('card-paid', 'credit_card', { nextPaymentDueOn: '2026-11-02', statementBalanceCents: 0 }),
      account('card-late', 'credit_card', { nextPaymentDueOn: '2026-10-20', statementBalanceCents: 9_000 }),
      account('loan-far', 'loan', { nextPaymentDueOn: '2026-11-21', minimumPaymentCents: 21_450 }),
      account('loan-closed', 'loan', { nextPaymentDueOn: '2026-11-01', minimumPaymentCents: 100, closedOn: '2026-10-01' }),
      account('checking', 'checking', { nextPaymentDueOn: '2026-11-01' }),
    ],
    [],
    [],
    TODAY,
  );

  it('lists open card and loan payments due within two weeks, soonest first', () => {
    expect(dueSoon(summaries, TODAY).map((d) => [d.account.id, d.dueOn, d.amountCents])).toEqual([
      ['card-first', '2026-10-31', 2_500],
      ['card-soon', '2026-11-03', 21_180],
    ]);
  });

  it('reaches further when asked', () => {
    expect(dueSoon(summaries, TODAY, 30).map((d) => d.account.id)).toContain('loan-far');
  });
});
