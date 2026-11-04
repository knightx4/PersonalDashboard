import {
  accountTitle,
  addDays,
  isOwed,
  netWorthSeries,
  type AccountRow,
  type Reading,
} from '@/lib/finances/accounts';
import { matchInternal, type InternalMatch } from '@/lib/finances/spending/internal';
import { longMonth } from '@/lib/finances/spending/months';
import { classify, findRepeating, merchantName, summarizeTransactions } from '@/lib/finances/spending/model';
import { merchantKey } from '@/lib/finances/spending/orders';
import type { SpendAccount, SpendTransaction } from '@/lib/finances/spending/types';
import { formatMoney, recentMonthKeys } from '@/lib/money';

/**
 * The monthly money review's figures (plan #2593.8.2), worked out in code so
 * the model only words them.
 *
 * Every figure goes through the rules the Finances pages use: spending is
 * summarizeTransactions over matchInternal, so a card payment or a transfer
 * between the person's own accounts is never counted as spending, and net
 * worth is netWorthSeries, which subtracts what is owed on cards and loans.
 * Nothing here sums amount_cents on its own.
 *
 * Each fact becomes one line of the review and carries the ids of the
 * transactions behind it. A fact about a balance (net worth, a payment
 * coming due) has no transaction behind it and carries its accounts instead.
 *
 * `plain` is the line as the code writes it. It is what is stored when there
 * is no model, and the model's wording of a line is kept only when every
 * number in it is one of the numbers in `plain` (lib/finances/review/write.ts).
 */

export type ReviewFactKind =
  | 'spending'
  | 'category'
  | 'new_subscription'
  | 'changed_subscription'
  | 'unusual'
  | 'interest'
  | 'due'
  | 'net_worth';

export interface ReviewFact {
  /** Stable within a month: 'spending', 'category:food and drink', 'due:<account id>'. */
  id: string;
  kind: ReviewFactKind;
  /** The line in the code's own words. */
  plain: string;
  /** The figures as the line may write them, by name, for the model. */
  figures: Record<string, string>;
  transactionIds: string[];
  accountIds: string[];
}

export interface MonthFacts {
  /** YYYY-MM. */
  month: string;
  /** "October 2026". */
  label: string;
  facts: ReviewFact[];
  /** The opening in the code's own words. */
  plainSummary: string;
}

export type ReviewAccount = AccountRow & { hidden: boolean };

export interface MonthFactsInput {
  /** YYYY-MM, the month reviewed. */
  month: string;
  /** YYYY-MM-DD in the person's timezone: the day the review is written. */
  today: string;
  accounts: readonly ReviewAccount[];
  /** From LOOKBACK_MONTHS before the month to a few days past its end. */
  transactions: readonly SpendTransaction[];
  /** From a couple of months before the month to its end. */
  readings: readonly Reading[];
}

/** How many months before the reviewed one are read: a year, to see a yearly charge repeat. */
export const LOOKBACK_MONTHS = 12;
/** The months each category is compared against. */
export const COMPARE_MONTHS = 3;
/** The most category lines a review keeps. */
const MAX_CATEGORIES = 6;
/** The most unusual charges a review names. */
const MAX_UNUSUAL = 5;
/** Payments due this many days after the review is written are named. */
export const DUE_WITHIN_DAYS = 14;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const usd = (cents: number) => formatMoney(cents, 'USD');

/** The first day of a YYYY-MM month. */
export function monthStart(month: string): string {
  return `${month}-01`;
}

/** The last day of a YYYY-MM month. */
export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** The month `back` months before a YYYY-MM month. */
export function monthBefore(month: string, back = 1): string {
  return recentMonthKeys(`${month}-01`, back + 1)[0];
}

/** The month a review written on `today` covers: the one before today's. */
export function reviewMonthFor(today: string): string {
  return monthBefore(today.slice(0, 7));
}

/** "14 October", from YYYY-MM-DD. */
export function dayLabel(day: string): string {
  return `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function keyOf(t: Pick<SpendTransaction, 'merchant' | 'description'>): string {
  const name = merchantName(t);
  return merchantKey(name) || name.toLowerCase();
}

function within(day: string, from: string, to: string): boolean {
  return day >= from && day <= to;
}

const PERIOD_WORD = { week: 'a week', month: 'a month', quarter: 'a quarter', year: 'a year' } as const;

export function buildMonthFacts(input: MonthFactsInput): MonthFacts {
  const { month, today } = input;
  const start = monthStart(month);
  const end = monthEnd(month);
  const name = MONTHS[Number(month.slice(5, 7)) - 1];
  const label = longMonth(month);

  const spendAccounts: SpendAccount[] = input.accounts.map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind,
    hidden: a.hidden,
    mask: a.mask,
  }));
  const accountById = new Map(input.accounts.map((a) => [a.id, a]));
  const spendById = new Map(spendAccounts.map((a) => [a.id, a]));
  const internal: Map<string, InternalMatch> = matchInternal(input.transactions, spendAccounts);

  const facts: ReviewFact[] = [];

  // -------------------------------------------------------------------------
  // Spending, in total and by category, against the months before.
  // -------------------------------------------------------------------------
  const summaryOf = (key: string) =>
    summarizeTransactions({
      transactions: input.transactions,
      accounts: spendAccounts,
      internal,
      orderFor: new Map(),
      period: { start: monthStart(key), end: monthEnd(key) },
      today: monthEnd(key),
    });
  const now = summaryOf(month);
  // Only months with something in them are compared against, so a month
  // before the transactions began does not drag the average down.
  const earlier = Array.from({ length: COMPARE_MONTHS }, (_, i) => summaryOf(monthBefore(month, i + 1)))
    .filter((s) => s.chargeCount > 0);

  const chargeIds = (filter: (categoryLabel: string) => boolean) =>
    now.merchants.flatMap((m) => m.charges.filter((c) => filter(c.categoryLabel)).map((c) => c.id));

  if (now.chargeCount > 0) {
    const usual = earlier.length > 0 ? Math.round(earlier.reduce((s, e) => s + e.spentCents, 0) / earlier.length) : null;
    const figures: Record<string, string> = { spent: usd(now.spentCents), charges: String(now.chargeCount) };
    let plain = `You spent ${usd(now.spentCents)} in ${name} across ${now.chargeCount} charge${now.chargeCount === 1 ? '' : 's'}`;
    if (usual !== null) {
      figures.usual = usd(usual);
      figures.months_compared = String(earlier.length);
      plain += `, against ${usd(usual)} ${earlier.length === 1 ? 'the month before' : `a month over the ${earlier.length} months before`}`;
    }
    facts.push({
      id: 'spending',
      kind: 'spending',
      plain: `${plain}.`,
      figures,
      transactionIds: [...new Set(now.merchants.flatMap((m) => m.charges.map((c) => c.id)))],
      accountIds: [],
    });

    const usualFor = (category: string) =>
      earlier.length > 0
        ? Math.round(earlier.reduce((s, e) => s + (e.categories.find((c) => c.label === category)?.cents ?? 0), 0) / earlier.length)
        : null;
    // The largest categories, then any smaller one that moved a long way.
    const moved = (cents: number, before: number | null) =>
      before !== null && Math.abs(cents - before) >= 5_000 && Math.abs(cents - before) >= before / 4;
    const chosen = now.categories.slice(0, 4);
    for (const c of now.categories.slice(4)) {
      if (chosen.length >= MAX_CATEGORIES) break;
      if (moved(c.cents, usualFor(c.label))) chosen.push(c);
    }
    for (const c of chosen) {
      const before = usualFor(c.label);
      const figures: Record<string, string> = { spent: usd(c.cents) };
      let plain = `${c.label} came to ${usd(c.cents)}`;
      if (before !== null && before > 0) {
        figures.usual = usd(before);
        const direction = !moved(c.cents, before) ? 'about the same as' : c.cents > before ? 'up from' : 'down from';
        plain += `, ${direction} ${usd(before)} a month before`;
      } else if (before === 0) {
        plain += ', with nothing in the months before';
      }
      facts.push({
        id: `category:${c.label.toLowerCase()}`,
        kind: 'category',
        plain: `${plain}.`,
        figures,
        transactionIds: chargeIds((l) => l === c.label),
        accountIds: [],
      });
    }
  }

  // -------------------------------------------------------------------------
  // Subscriptions: new ones, and ones whose price changed.
  // -------------------------------------------------------------------------
  const spends = input.transactions.filter(
    (t) => t.postedOn <= end && classify(t, spendById.get(t.accountId), internal) === 'spend',
  );
  const byKey = new Map<string, SpendTransaction[]>();
  for (const t of spends) {
    const list = byKey.get(keyOf(t)) ?? [];
    list.push(t);
    byKey.set(keyOf(t), list);
  }
  for (const list of byKey.values()) list.sort((a, b) => a.postedOn.localeCompare(b.postedOn) || a.id.localeCompare(b.id));

  const repeatingNow = findRepeating(spends, end);
  const repeatingBefore = findRepeating(
    spends.filter((t) => t.postedOn < start),
    addDays(start, -1),
  );
  const before = new Set(repeatingBefore.map((r) => r.key));
  const repeatingKeys = new Set([...repeatingNow, ...repeatingBefore].map((r) => r.key));

  for (const r of repeatingNow) {
    if (before.has(r.key) || !within(r.lastOn, start, end)) continue;
    const charges = (byKey.get(r.key) ?? []).filter((t) => within(t.postedOn, r.firstOn, r.lastOn));
    facts.push({
      id: `new:${r.key}`,
      kind: 'new_subscription',
      plain: `${r.name} now charges ${usd(r.amountCents)} ${PERIOD_WORD[r.period]}, ${r.count} times since ${dayLabel(r.firstOn)}.`,
      figures: { amount: usd(r.amountCents), charges: String(r.count), since: dayLabel(r.firstOn) },
      transactionIds: charges.map((t) => t.id),
      accountIds: [],
    });
  }

  for (const r of repeatingBefore) {
    const list = byKey.get(r.key) ?? [];
    const prior = list.filter((t) => t.postedOn < start);
    const inMonth = list.filter((t) => within(t.postedOn, start, end));
    if (prior.length < 2 || inMonth.length === 0) continue;
    const last = prior[prior.length - 1];
    const steady = last.amountCents === prior[prior.length - 2].amountCents;
    const latest = inMonth[inMonth.length - 1];
    const was = -last.amountCents;
    const is = -latest.amountCents;
    if (!steady || Math.abs(is - was) < 50) continue;
    facts.push({
      id: `changed:${r.key}`,
      kind: 'changed_subscription',
      plain: `${merchantName(latest)} went from ${usd(was)} to ${usd(is)} ${PERIOD_WORD[r.period]}.`,
      figures: { was: usd(was), now: usd(is) },
      transactionIds: [last.id, latest.id],
      accountIds: [],
    });
  }

  // -------------------------------------------------------------------------
  // Unusual charges: far above what that merchant usually charges, or a large
  // first charge from a merchant not seen in the year before.
  // -------------------------------------------------------------------------
  const yearAgo = monthStart(monthBefore(month, LOOKBACK_MONTHS));
  const recentFrom = monthStart(monthBefore(month, COMPARE_MONTHS));
  const recent = spends.filter((t) => within(t.postedOn, recentFrom, addDays(start, -1))).map((t) => -t.amountCents);
  const typical = recent.length > 0 ? median(recent) : 0;
  const unusual: { t: SpendTransaction; plain: string; figures: Record<string, string> }[] = [];
  for (const t of spends) {
    if (!within(t.postedOn, start, end)) continue;
    const key = keyOf(t);
    if (repeatingKeys.has(key)) continue;
    const cents = -t.amountCents;
    const history = (byKey.get(key) ?? [])
      .filter((h) => within(h.postedOn, yearAgo, addDays(start, -1)))
      .map((h) => -h.amountCents);
    const where = `${usd(cents)} at ${merchantName(t)} on ${dayLabel(t.postedOn)}`;
    if (history.length > 0) {
      const usual = median(history);
      if (cents >= 5_000 && cents >= usual * 3 && cents - usual >= 5_000) {
        unusual.push({
          t,
          plain: `${where}, where a charge is usually ${usd(usual)}.`,
          figures: { amount: usd(cents), usual: usd(usual), on: dayLabel(t.postedOn) },
        });
      }
    } else if (cents >= 25_000 && cents >= typical * 3) {
      unusual.push({
        t,
        plain: `${where}, the first charge from them in a year.`,
        figures: { amount: usd(cents), on: dayLabel(t.postedOn) },
      });
    }
  }
  unusual
    .sort((a, b) => a.t.amountCents - b.t.amountCents || a.t.postedOn.localeCompare(b.t.postedOn))
    .slice(0, MAX_UNUSUAL)
    .forEach(({ t, plain, figures }) =>
      facts.push({ id: `unusual:${t.id}`, kind: 'unusual', plain, figures, transactionIds: [t.id], accountIds: [] }),
    );

  // -------------------------------------------------------------------------
  // Interest charged on cards and loans.
  // -------------------------------------------------------------------------
  const interest = new Map<string, SpendTransaction[]>();
  for (const t of input.transactions) {
    const account = accountById.get(t.accountId);
    if (!account || account.hidden || t.pending || !within(t.postedOn, start, end)) continue;
    if (!isOwed(account.kind) || internal.has(t.id) || t.amountCents === 0) continue;
    const isInterest = t.categoryDetail === 'BANK_FEES_INTEREST_CHARGE' || /\binterest\b/i.test(t.description);
    if (!isInterest) continue;
    const list = interest.get(account.id) ?? [];
    list.push(t);
    interest.set(account.id, list);
  }
  for (const [accountId, list] of interest) {
    // Interest is money out of the account; a reversal comes back in.
    const cents = list.reduce((s, t) => s - t.amountCents, 0);
    if (cents <= 0) continue;
    const account = accountById.get(accountId)!;
    facts.push({
      id: `interest:${accountId}`,
      kind: 'interest',
      plain: `${accountTitle(account)} charged ${usd(cents)} in interest.`,
      figures: { interest: usd(cents) },
      transactionIds: list.map((t) => t.id),
      accountIds: [accountId],
    });
  }

  // -------------------------------------------------------------------------
  // Card and loan payments coming due after the review is written.
  // -------------------------------------------------------------------------
  const dueBy = addDays(today, DUE_WITHIN_DAYS);
  const due = input.accounts
    .filter(
      (a) =>
        isOwed(a.kind) &&
        !a.hidden &&
        !a.closedOn &&
        a.nextPaymentDueOn !== null &&
        within(a.nextPaymentDueOn, today, dueBy),
    )
    .sort((a, b) => a.nextPaymentDueOn!.localeCompare(b.nextPaymentDueOn!) || a.name.localeCompare(b.name));
  for (const a of due) {
    const on = dayLabel(a.nextPaymentDueOn!);
    const figures: Record<string, string> = { due_on: on };
    const parts: string[] = [];
    if (a.minimumPaymentCents !== null) {
      figures.minimum = usd(a.minimumPaymentCents);
      parts.push(`${usd(a.minimumPaymentCents)} at least`);
    }
    if (a.kind === 'credit_card' && a.statementBalanceCents !== null) {
      figures.statement = usd(a.statementBalanceCents);
      parts.push(`${usd(a.statementBalanceCents)} to clear the statement`);
    }
    facts.push({
      id: `due:${a.id}`,
      kind: 'due',
      plain: `${accountTitle(a)} is due on ${on}${parts.length > 0 ? `: ${parts.join(', ')}` : ''}.`,
      figures,
      transactionIds: [],
      accountIds: [a.id],
    });
  }

  // -------------------------------------------------------------------------
  // Net worth over the month: the day before it began to its last day.
  // -------------------------------------------------------------------------
  const counted = input.accounts.filter((a) => !a.hidden);
  const series = netWorthSeries(counted, input.readings, end, Number(end.slice(8, 10)) + 1);
  if (series.length >= 2) {
    const first = series[0];
    const last = series[series.length - 1];
    const change = last.cents - first.cents;
    const direction = change > 0 ? `up ${usd(change)}` : change < 0 ? `down ${usd(-change)}` : 'no change';
    const withReadings = new Set(input.readings.filter((r) => r.readOn <= end).map((r) => r.accountId));
    facts.push({
      id: 'net_worth',
      kind: 'net_worth',
      plain: `Net worth went from ${usd(first.cents)} on ${dayLabel(first.day)} to ${usd(last.cents)} on ${dayLabel(last.day)}, ${direction}.`,
      figures: {
        start: usd(first.cents),
        end: usd(last.cents),
        change: usd(Math.abs(change)),
        from: dayLabel(first.day),
        to: dayLabel(last.day),
      },
      transactionIds: [],
      accountIds: counted.filter((a) => withReadings.has(a.id)).map((a) => a.id),
    });
  }

  return { month, label, facts, plainSummary: plainSummary(name, facts) };
}

function plainSummary(name: string, facts: readonly ReviewFact[]): string {
  if (facts.length === 0) return `Nothing came through your accounts in ${name}, so there is nothing to review.`;
  const spending = facts.find((f) => f.kind === 'spending');
  const worth = facts.find((f) => f.kind === 'net_worth');
  const parts: string[] = [];
  if (spending) parts.push(`you spent ${spending.figures.spent}`);
  if (worth) parts.push(`net worth ended at ${worth.figures.end}`);
  if (parts.length === 0) return `${name} in your accounts, line by line.`;
  const sentence = parts.join(' and ');
  return `In ${name} ${sentence}.`;
}
