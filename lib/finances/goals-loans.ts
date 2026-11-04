import type { AccountRow, Reading } from './accounts';

/**
 * Student loans from Goals, as Finances accounts (plan #2593.5).
 *
 * Goals keeps a `loans` collection, one record per loan, filled from the
 * NSLDS file and the servicer's statement emails: its balance (tracked, so
 * every change is a dated reading in goals.readings), rate, minimum payment
 * and next due date. Finances does not copy those numbers. Each record is
 * read as an account at the moment the page is drawn, so the two workspaces
 * never disagree, and the account's id is the record's.
 *
 * When Plaid does reach the servicer, the linked loan accounts are the
 * better source, updated every morning, and the Goals rows for that servicer
 * step aside so no loan is counted twice in net worth.
 *
 * Money fields in a collection are dollars (goals.record_value_error), so
 * they are turned into cents here.
 */

/** The collection Goals keeps the loans in, matched by name. */
export const LOANS_COLLECTION = 'loans';

/** One goals.records row of the loans collection, as read. */
export type GoalLoanRecord = {
  id: string;
  data: Record<string, unknown>;
  /** The day the record's figures are as of, when read from a document. */
  asOf: string | null;
  updatedAt: string;
  /** The goal the collection serves, for the link back to it. */
  goalId: string | null;
};

/** One tracked balance of a loan record, from goals.readings. */
export type GoalLoanReading = { recordId: string; readOn: string; value: number };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const text = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

const number = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

const cents = (dollars: number | null): number | null =>
  dollars === null ? null : Math.round(dollars * 100);

const day = (v: unknown): string | null => {
  const s = text(v);
  return s && DAY.test(s) ? s : null;
};

/** Letters and digits only, lower case: "EdFinancial Services" → "edfinancialservices". */
function squash(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Whether a linked institution is this servicer: either name holds the
 * other once spaces and punctuation are gone, so "Edfinancial" matches
 * Plaid's "EdFinancial Services".
 */
export function sameServicer(servicer: string, institution: string): boolean {
  const a = squash(servicer);
  const b = squash(institution);
  if (a.length < 3 || b.length < 3) return false;
  return a.includes(b) || b.includes(a);
}

export type GoalLoanAccount = { account: AccountRow; readings: Reading[]; goalId: string | null };

/**
 * Each loan record as an account and its balance history. The balance is the
 * record's own, as of the day its figures are dated (the record's as_of, the
 * as_of in its values, or the day it was last saved), and the history is
 * the tracked readings before that. A record with no balance shows with
 * none. Records whose servicer Plaid links are left out.
 */
export function goalLoanAccounts(
  records: readonly GoalLoanRecord[],
  readings: readonly GoalLoanReading[],
  linkedLoanInstitutions: readonly string[],
): GoalLoanAccount[] {
  const out: GoalLoanAccount[] = [];
  for (const record of records) {
    const d = record.data;
    const servicer = text(d.servicer);
    if (servicer && linkedLoanInstitutions.some((inst) => sameServicer(servicer, inst))) continue;

    const balanceCents = cents(number(d.balance));
    const readOn = record.asOf ?? day(d.as_of) ?? record.updatedAt.slice(0, 10);
    const history = new Map<string, number>();
    for (const r of readings) {
      if (r.recordId === record.id && r.readOn <= readOn)
        history.set(r.readOn, Math.round(r.value * 100));
    }
    // The record is the latest word, whatever the readings say on its day.
    if (balanceCents !== null) history.set(readOn, balanceCents);

    const kindWord = text(d.loan_type);
    out.push({
      account: {
        id: record.id,
        name: text(d.name) ?? kindWord ?? 'Student loan',
        officialName: kindWord,
        institutionName: servicer,
        mask: null,
        kind: 'loan',
        source: 'goals',
        linkId: null,
        creditLimitCents: null,
        interestRate: number(d.rate),
        minimumPaymentCents: cents(number(d.minimum)),
        nextPaymentDueOn: day(d.next_due),
        statementBalanceCents: null,
        closedOn: null,
      },
      readings: [...history.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([readOn, balanceCents]) => ({ accountId: record.id, readOn, balanceCents })),
      goalId: record.goalId,
    });
  }
  return out;
}

export const goalHref = (goalId: string) => `/goals/${goalId}`;
