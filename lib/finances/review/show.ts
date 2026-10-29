import { accountTitle, type AccountRow } from '@/lib/finances/accounts';
import { longMonth } from '@/lib/finances/spending/months';
import type { ReviewFactKind } from './facts';
import { MAX_ATTEMPTS } from './run';
import type { StoredLine } from './write';

/**
 * The monthly money review as Finances shows it (plan #2593.8.3), worked out
 * from the stored row (finances.month_reviews, plan #2593.8.2) and the rows
 * its lines name. Pure, so the gallery draws every state from fixtures.
 *
 * A line keeps the transactions behind it as plain ids, so the page reads
 * them by id and hands them here. A line about a balance (a payment due, net
 * worth) has none and names its accounts instead, which the page links to.
 */

/** The charges a line's popover lists; the rest are counted under them. */
export const CHARGES_SHOWN = 8;

/** One transaction behind a line, as its popover lists it. */
export type ReviewCharge = {
  id: string;
  accountId: string;
  postedOn: string;
  /** The merchant, or the bank's description when there is none. */
  name: string;
  /** Negative for money out, as finances.transactions keeps it. */
  amountCents: number;
  pending: boolean;
};

/** An account a line names, for its link. */
export type ReviewAccount = { id: string; title: string };

export type ShownLine = {
  id: string;
  kind: ReviewFactKind;
  text: string;
  /** The largest charges behind the line, at most CHARGES_SHOWN. */
  charges: ReviewCharge[];
  /** Every charge behind the line that could be read. */
  chargeCount: number;
  /** Their sum, negative for money out. */
  totalCents: number;
  /** The accounts it names, when it names no charge. */
  accounts: ReviewAccount[];
};

export type ShownReview = {
  id: string;
  /** YYYY-MM, what Try again is given. */
  month: string;
  /** "October 2026". */
  label: string;
  /**
   * written: lines to read. quiet: written, and the month had nothing in it.
   * failed: the run broke; `lines` may still hold the code's own sentences.
   */
  state: 'written' | 'quiet' | 'failed';
  summary: string | null;
  lines: ShownLine[];
  /** Runs that have tried this month. */
  attempts: number;
  /** Whether the daily run has stopped trying on its own. */
  gaveUp: boolean;
};

/** What sits at the top of Finances: a review, word of the first one, or nothing. */
export type ReviewPanel =
  | { kind: 'review'; review: ShownReview }
  | {
      kind: 'first';
      /** "October 2026", the month the first review covers. */ label: string;
      /** YYYY-MM-DD it is written. */ on: string;
    }
  | null;

/** finances.month_reviews as the page reads it. */
export type MonthReviewRecord = {
  id: string;
  /** YYYY-MM-01. */
  month: string;
  status: 'written' | 'failed';
  summary: string | null;
  lines: unknown;
  facts: unknown;
  attempts: number;
};

/** The columns the page reads. */
export const MONTH_REVIEW_COLUMNS = 'id, month, status, summary, lines, facts, attempts';

/** The month's name as the facts give it, or worked out from the date. */
export function reviewLabel(record: Pick<MonthReviewRecord, 'month' | 'facts'>): string {
  const facts = record.facts as { label?: unknown } | null;
  if (facts && typeof facts.label === 'string' && facts.label.trim()) return facts.label.trim();
  return longMonth(record.month.slice(0, 7));
}

const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/** The stored lines, keeping only ones in the shape the run writes. */
export function storedLines(lines: unknown): StoredLine[] {
  if (!Array.isArray(lines)) return [];
  return lines.flatMap((raw) => {
    const line = raw as Partial<StoredLine> | null;
    if (!line || typeof line.id !== 'string' || typeof line.text !== 'string' || !line.text.trim())
      return [];
    return [
      {
        id: line.id,
        kind: line.kind as ReviewFactKind,
        text: line.text.trim(),
        transaction_ids: Array.isArray(line.transaction_ids)
          ? line.transaction_ids.filter(isId)
          : [],
        account_ids: Array.isArray(line.account_ids) ? line.account_ids.filter(isId) : [],
      },
    ];
  });
}

/** Every transaction id the lines name, once each: what the page reads. */
export function transactionIdsOf(lines: readonly StoredLine[]): string[] {
  return [...new Set(lines.flatMap((l) => l.transaction_ids))];
}

/** Every account id the lines name, once each. */
export function accountIdsOf(lines: readonly StoredLine[]): string[] {
  return [...new Set(lines.flatMap((l) => l.account_ids))];
}

/**
 * The review to show, from its row and the transactions and accounts its
 * lines name. A charge that could not be read (deleted since, or another
 * account's) is left out rather than shown as a gap.
 */
export function showReview(
  record: MonthReviewRecord,
  charges: ReadonlyMap<string, ReviewCharge>,
  accounts: ReadonlyMap<string, Pick<AccountRow, 'id' | 'name' | 'mask'>>,
): ShownReview {
  const lines = storedLines(record.lines).map((line): ShownLine => {
    const behind = line.transaction_ids.flatMap((id) => {
      const charge = charges.get(id);
      return charge ? [charge] : [];
    });
    const largest = [...behind].sort(
      (a, b) =>
        Math.abs(b.amountCents) - Math.abs(a.amountCents) || b.postedOn.localeCompare(a.postedOn),
    );
    return {
      id: line.id,
      kind: line.kind,
      text: line.text,
      charges: largest.slice(0, CHARGES_SHOWN),
      chargeCount: behind.length,
      totalCents: behind.reduce((sum, c) => sum + c.amountCents, 0),
      accounts: line.account_ids.flatMap((id) => {
        const account = accounts.get(id);
        return account ? [{ id, title: accountTitle(account) }] : [];
      }),
    };
  });
  const state = record.status === 'failed' ? 'failed' : lines.length === 0 ? 'quiet' : 'written';
  return {
    id: record.id,
    month: record.month.slice(0, 7),
    label: reviewLabel(record),
    state,
    summary: record.summary?.trim() || null,
    lines,
    attempts: record.attempts,
    gaveUp: record.status === 'failed' && record.attempts >= MAX_ATTEMPTS,
  };
}

/**
 * The first of the month after `today`, when the review of `today`'s month
 * is written, and that month's name: what the page says before there is a
 * review to show.
 */
export function firstReview(today: string): { label: string; on: string } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
  return { label: longMonth(today.slice(0, 7)), on: `${next}-01` };
}
