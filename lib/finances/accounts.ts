/**
 * Every account the person holds, as the Accounts page reads them (plan
 * #2593.6): grouped by kind, each with its latest balance, where it comes
 * from and how old it is, and net worth over time from the daily readings.
 *
 * Pure: the store (accounts-store.ts) reads the rows and this works out what
 * the page shows, so the rules are tested without a database. Money is integer
 * cents throughout, as lib/money.ts requires, and a day is a bare
 * `YYYY-MM-DD`.
 *
 * Two sign rules from migrations-finances/0001 decide most of it. A credit
 * card's or a loan's balance is the amount owed, as a positive number, so net
 * worth subtracts those two kinds. A transaction's amount is positive for
 * money in and negative for money out, whatever the kind.
 */

export type AccountKind = 'checking' | 'savings' | 'credit_card' | 'brokerage' | 'loan';
export type AccountSource = 'plaid' | 'import' | 'goals' | 'manual';
export type AccountGroup = 'cash' | 'cards' | 'investments' | 'loans';

/** One finances.accounts row, as the page needs it. */
export type AccountRow = {
  id: string;
  name: string;
  officialName: string | null;
  institutionName: string | null;
  mask: string | null;
  kind: AccountKind;
  source: AccountSource;
  linkId: string | null;
  creditLimitCents: number | null;
  /** The annual percentage: 6.54 for 6.54%. A card's purchase APR, a loan's rate. */
  interestRate: number | null;
  minimumPaymentCents: number | null;
  nextPaymentDueOn: string | null;
  /** A card's balance on its last statement (migrations-finances/0004_plaid_sync). */
  statementBalanceCents: number | null;
  closedOn: string | null;
};

/** One day's balance of one account. */
export type Reading = { accountId: string; readOn: string; balanceCents: number };

/** One security in a brokerage account, as of a date. */
export type Holding = {
  accountId: string;
  securityName: string;
  ticker: string | null;
  quantity: number;
  valueCents: number;
  costBasisCents: number | null;
  asOf: string;
};

/** The groups, in the order the page lists them, with their headings. */
export const ACCOUNT_GROUPS: readonly { id: AccountGroup; label: string }[] = [
  { id: 'cash', label: 'Cash' },
  { id: 'cards', label: 'Credit cards' },
  { id: 'investments', label: 'Investments' },
  { id: 'loans', label: 'Loans' },
];

export function groupOf(kind: AccountKind): AccountGroup {
  switch (kind) {
    case 'checking':
    case 'savings':
      return 'cash';
    case 'credit_card':
      return 'cards';
    case 'brokerage':
      return 'investments';
    case 'loan':
      return 'loans';
  }
}

/** Whether the balance is what is owed, which net worth subtracts. */
export function isOwed(kind: AccountKind): boolean {
  return kind === 'credit_card' || kind === 'loan';
}

/** The balance as it counts towards net worth: owed balances are negative. */
export function netContribution(kind: AccountKind, balanceCents: number): number {
  return isOwed(kind) ? -balanceCents : balanceCents;
}

export const KIND_LABEL: Record<AccountKind, string> = {
  checking: 'Checking',
  savings: 'Savings',
  credit_card: 'Credit card',
  brokerage: 'Brokerage',
  loan: 'Loan',
};

export const SOURCE_LABEL: Record<AccountSource, string> = {
  plaid: 'Plaid',
  import: 'Import',
  goals: 'Goals',
  manual: 'Manual',
};

/**
 * How old a balance may be before it is called stale, by where it comes
 * from. A linked account syncs every morning, so a reading older than a day
 * means the sync has stopped. Imported, manual and Goals balances arrive
 * once a statement, and #2593.5 asks for a new one after 35 days.
 */
export const STALE_AFTER_DAYS: Record<AccountSource, number> = {
  plaid: 1,
  import: 35,
  goals: 35,
  manual: 35,
};

const DAY_MS = 86_400_000;

function dayNumber(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) / DAY_MS;
}

/** Whole days from `from` to `to`; positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
  return Math.round(dayNumber(to) - dayNumber(from));
}

/** The day `days` after `day`. */
export function addDays(day: string, days: number): string {
  return new Date((dayNumber(day) + days) * DAY_MS).toISOString().slice(0, 10);
}

/** How old a balance read on `readOn` is today, and whether that is too old. */
export function freshness(
  source: AccountSource,
  readOn: string | null,
  today: string,
): { ageDays: number | null; stale: boolean } {
  if (!readOn) return { ageDays: null, stale: true };
  const ageDays = Math.max(0, daysBetween(readOn, today));
  return { ageDays, stale: ageDays > STALE_AFTER_DAYS[source] };
}

/** "Today", "Yesterday", "3 days old", "5 weeks old": a balance's age in words. */
export function ageLabel(ageDays: number | null): string {
  if (ageDays === null) return 'No balance yet';
  if (ageDays === 0) return 'Today';
  if (ageDays === 1) return 'Yesterday';
  if (ageDays < 14) return `${ageDays} days old`;
  if (ageDays < 61) return `${Math.floor(ageDays / 7)} weeks old`;
  return `${Math.floor(ageDays / 30)} months old`;
}

/** How much of a card's limit the balance uses, 0 to 1 and over; null without a limit. */
export function limitUsed(
  balanceCents: number | null,
  creditLimitCents: number | null,
): number | null {
  if (balanceCents === null || !creditLimitCents || creditLimitCents <= 0) return null;
  return Math.max(0, balanceCents) / creditLimitCents;
}

/** Whole percent, for a fraction such as limitUsed's. */
export function percentLabel(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** Longest a payoff is worked out for: fifty years. */
const PAYOFF_MAX_MONTHS = 600;

export type Payoff =
  | { kind: 'paid' }
  | { kind: 'on'; months: number; month: string }
  | { kind: 'never' };

/**
 * When a loan is paid off at its monthly payment: the month of the last
 * payment, counting the first as the month after `today`. The standard
 * amortisation, n = -log(1 - rB/P) / log(1 + r) with r the monthly rate.
 * 'never' when the payment does not cover the interest, null when the
 * balance or the payment is unknown.
 */
export function loanPayoff(
  balanceCents: number | null,
  annualRatePercent: number | null,
  paymentCents: number | null,
  today: string,
): Payoff | null {
  if (balanceCents === null) return null;
  if (balanceCents <= 0) return { kind: 'paid' };
  if (!paymentCents || paymentCents <= 0) return null;
  const r = (annualRatePercent ?? 0) / 100 / 12;
  let months: number;
  if (r === 0) {
    months = Math.ceil(balanceCents / paymentCents);
  } else {
    const share = (r * balanceCents) / paymentCents;
    if (share >= 1) return { kind: 'never' };
    months = Math.ceil(-Math.log(1 - share) / Math.log(1 + r));
  }
  if (months > PAYOFF_MAX_MONTHS) return { kind: 'never' };
  const year = Number(today.slice(0, 4));
  const month0 = Number(today.slice(5, 7)) - 1 + months;
  const y = year + Math.floor(month0 / 12);
  const m = (month0 % 12) + 1;
  return { kind: 'on', months, month: `${y}-${String(m).padStart(2, '0')}` };
}

export type InvestmentValue = {
  valueCents: number;
  /** What the holdings with a known cost basis cost; null when none has one. */
  costCents: number | null;
  /** Their value less that cost. */
  gainCents: number | null;
  asOf: string | null;
};

/**
 * A brokerage account's value and its gain against cost, from its newest
 * holdings. Only holdings with a cost basis count towards the gain, so a
 * position Plaid gives no basis for neither adds nor hides a gain.
 */
export function investmentValue(holdings: readonly Holding[]): InvestmentValue {
  const asOf = holdings.reduce<string | null>(
    (max, h) => (max === null || h.asOf > max ? h.asOf : max),
    null,
  );
  const current = holdings.filter((h) => h.asOf === asOf);
  let valueCents = 0;
  let costCents = 0;
  let pricedValue = 0;
  let priced = 0;
  for (const h of current) {
    valueCents += h.valueCents;
    if (h.costBasisCents !== null) {
      costCents += h.costBasisCents;
      pricedValue += h.valueCents;
      priced += 1;
    }
  }
  return {
    valueCents,
    costCents: priced > 0 ? costCents : null,
    gainCents: priced > 0 ? pricedValue - costCents : null,
    asOf,
  };
}

/** The newest holdings only, largest value first. */
export function currentHoldings(holdings: readonly Holding[]): Holding[] {
  const asOf = holdings.reduce<string | null>(
    (max, h) => (max === null || h.asOf > max ? h.asOf : max),
    null,
  );
  return holdings.filter((h) => h.asOf === asOf).sort((a, b) => b.valueCents - a.valueCents);
}

/** One account as a row of the Accounts page shows it. */
export type AccountSummary = AccountRow & {
  balanceCents: number | null;
  readOn: string | null;
  ageDays: number | null;
  stale: boolean;
  /** Cards: how much of the limit is used. */
  limitUsed: number | null;
  /** Loans: when it is paid off at its monthly payment. */
  payoff: Payoff | null;
  /** Brokerage: value and gain against cost. */
  investment: InvestmentValue | null;
  /** Comments in the account's thread. */
  comments: number;
};

/** The newest reading of each account. */
export function latestReadings(readings: readonly Reading[]): Map<string, Reading> {
  const latest = new Map<string, Reading>();
  for (const r of readings) {
    const held = latest.get(r.accountId);
    if (!held || r.readOn > held.readOn) latest.set(r.accountId, r);
  }
  return latest;
}

/** Each account with its balance, age and the extra figures its kind shows. */
export function summarize(
  accounts: readonly AccountRow[],
  readings: readonly Reading[],
  holdings: readonly Holding[],
  today: string,
  comments: ReadonlyMap<string, number> = new Map(),
): AccountSummary[] {
  const latest = latestReadings(readings);
  return accounts.map((account) => {
    const reading = latest.get(account.id) ?? null;
    const own =
      account.kind === 'brokerage' ? holdings.filter((h) => h.accountId === account.id) : [];
    const investment = account.kind === 'brokerage' && own.length > 0 ? investmentValue(own) : null;
    // A brokerage with holdings and no reading is worth what it holds.
    const balanceCents = reading?.balanceCents ?? investment?.valueCents ?? null;
    const readOn = reading?.readOn ?? investment?.asOf ?? null;
    const { ageDays, stale } = freshness(account.source, readOn, today);
    return {
      ...account,
      balanceCents,
      readOn,
      ageDays,
      stale,
      limitUsed:
        account.kind === 'credit_card' ? limitUsed(balanceCents, account.creditLimitCents) : null,
      payoff:
        account.kind === 'loan'
          ? loanPayoff(balanceCents, account.interestRate, account.minimumPaymentCents, today)
          : null,
      investment,
      comments: comments.get(account.id) ?? 0,
    };
  });
}

/** The accounts in their groups, in page order, leaving out empty groups. */
export function grouped(
  accounts: readonly AccountSummary[],
): { id: AccountGroup; label: string; accounts: AccountSummary[]; totalCents: number }[] {
  return ACCOUNT_GROUPS.map((group) => {
    const members = accounts
      .filter((a) => groupOf(a.kind) === group.id)
      .sort(
        (a, b) => (b.balanceCents ?? 0) - (a.balanceCents ?? 0) || a.name.localeCompare(b.name),
      );
    return {
      ...group,
      accounts: members,
      totalCents: members.reduce((sum, a) => sum + (a.balanceCents ?? 0), 0),
    };
  }).filter((group) => group.accounts.length > 0);
}

export type NetWorthPoint = { day: string; cents: number };

/** Days of history the net worth chart covers. */
export const NET_WORTH_DAYS = 365;

/**
 * Net worth on each day from the first reading (or `days` before `today`,
 * whichever is later) to today: assets less cards and loans. An account's
 * balance on a day is its newest reading on or before it, so an account read
 * once a month holds its balance between statements rather than dropping to
 * nothing. An account counts from its first reading, and not after the day
 * it closed.
 */
export function netWorthSeries(
  accounts: readonly Pick<AccountRow, 'id' | 'kind' | 'closedOn'>[],
  readings: readonly Reading[],
  today: string,
  days: number = NET_WORTH_DAYS,
): NetWorthPoint[] {
  const kinds = new Map(accounts.map((a) => [a.id, a]));
  const own = readings
    .filter((r) => kinds.has(r.accountId) && r.readOn <= today)
    .sort((a, b) => a.readOn.localeCompare(b.readOn));
  if (own.length === 0) return [];

  const window = addDays(today, -(days - 1));
  const start = own[0].readOn > window ? own[0].readOn : window;
  const current = new Map<string, number>();
  let next = 0;
  // Readings before the window set where each account starts.
  while (next < own.length && own[next].readOn < start) {
    current.set(own[next].accountId, own[next].balanceCents);
    next += 1;
  }

  const points: NetWorthPoint[] = [];
  for (let day = start; day <= today; day = addDays(day, 1)) {
    while (next < own.length && own[next].readOn === day) {
      current.set(own[next].accountId, own[next].balanceCents);
      next += 1;
    }
    let cents = 0;
    for (const [id, balance] of current) {
      const account = kinds.get(id)!;
      if (account.closedOn && account.closedOn < day) continue;
      cents += netContribution(account.kind, balance);
    }
    points.push({ day, cents });
  }
  return points;
}

/** Net worth now: the sum of every open account's latest balance, owed ones subtracted. */
export function netWorthNow(accounts: readonly AccountSummary[]): number {
  return accounts.reduce(
    (sum, a) =>
      a.balanceCents === null || a.closedOn ? sum : sum + netContribution(a.kind, a.balanceCents),
    0,
  );
}

/**
 * How net worth moved over the last `days` days: the change from the point
 * that many days ago, or from the first point when the history is shorter.
 * Null with fewer than two points.
 */
export function netWorthChange(
  series: readonly NetWorthPoint[],
  days: number,
): { cents: number; since: string } | null {
  if (series.length < 2) return null;
  const last = series[series.length - 1];
  const target = addDays(last.day, -days);
  const from = series.find((p) => p.day >= target) ?? series[0];
  if (from === last) return null;
  return { cents: last.cents - from.cents, since: from.day };
}

/** A balance history of one account, oldest first, as chart points. */
export function balanceSeries(readings: readonly Reading[], accountId: string): NetWorthPoint[] {
  return readings
    .filter((r) => r.accountId === accountId)
    .sort((a, b) => a.readOn.localeCompare(b.readOn))
    .map((r) => ({ day: r.readOn, cents: r.balanceCents }));
}

/** "Total Checking ··4417": a name with the digits that tell two cards apart. */
export function accountTitle(account: Pick<AccountRow, 'name' | 'mask'>): string {
  // A no-break space, so the digits never sit alone on a line of their own.
  return account.mask ? `${account.name} ··${account.mask}` : account.name;
}

export const accountHref = (id: string) => `/finances/accounts/${id}`;
