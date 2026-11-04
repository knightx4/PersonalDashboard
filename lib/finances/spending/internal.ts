import type { AccountKind, InternalKind, SpendAccount, SpendTransaction } from './types';

/**
 * Card payments and transfers between the person's own accounts (plan
 * #2593.7), found so Spending counts a purchase once, on the card, and not
 * again when checking pays the card.
 *
 * Three ways a transaction is internal, in this order:
 *
 *   1. It says so: internal_kind is set on the row (saved by the matcher, or
 *      a correction the person made).
 *   2. It pairs with the other half: money out of one of their accounts and
 *      the same amount into another of theirs within PAIR_WINDOW_DAYS, where
 *      either half reads as a payment or a transfer (its category or its
 *      description). Out of checking into a card or a loan is a card
 *      payment; between two other accounts it is a transfer.
 *   3. Its category alone says so, for a half whose partner is on an account
 *      not linked yet: Plaid's credit card payment, when the person holds a
 *      card, and its transfer between accounts.
 *
 * A charge on a card and a refund of the same amount never pair: money out of
 * a card is never the out half (a cash advance aside, which reads as
 * spending, as the bank treats it).
 */

export interface InternalMatch {
  kind: InternalKind;
  /** The other half, when both are on the person's accounts. */
  pairId: string | null;
  /** How it was found, for the page's caption and for saving. */
  by: 'saved' | 'pair' | 'category';
}

/** How far apart the two halves of one payment may post. */
export const PAIR_WINDOW_DAYS = 4;

/** Accounts money can leave as the out half of a payment or transfer. */
const OUT_KINDS: ReadonlySet<AccountKind> = new Set(['checking', 'savings', 'brokerage']);

const CARD_PAYMENT_DETAILS = new Set(['LOAN_PAYMENTS_CREDIT_CARD_PAYMENT']);
const TRANSFER_DETAILS = new Set([
  'TRANSFER_IN_ACCOUNT_TRANSFER',
  'TRANSFER_OUT_ACCOUNT_TRANSFER',
  'TRANSFER_IN_SAVINGS',
  'TRANSFER_OUT_SAVINGS',
]);
const MOVE_CATEGORIES = new Set(['TRANSFER_IN', 'TRANSFER_OUT', 'LOAN_PAYMENTS']);
const MOVE_WORDS = /\b(payment|pymt|pmt|autopay|epay|transfer|xfer|trnsfr|thank you)\b/i;

/** Whole days from `a` to `b`, both YYYY-MM-DD. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

function readsAsMove(t: SpendTransaction): boolean {
  if (t.category && MOVE_CATEGORIES.has(t.category)) return true;
  if (t.categoryDetail && (CARD_PAYMENT_DETAILS.has(t.categoryDetail) || TRANSFER_DETAILS.has(t.categoryDetail))) {
    return true;
  }
  return MOVE_WORDS.test(t.description);
}

function kindFor(outKind: AccountKind, inKind: AccountKind): InternalKind {
  return outKind === 'credit_card' || inKind === 'credit_card' || inKind === 'loan'
    ? 'card_payment'
    : 'transfer';
}

export function matchInternal(
  transactions: readonly SpendTransaction[],
  accounts: readonly SpendAccount[],
): Map<string, InternalMatch> {
  const kindOf = new Map(accounts.map((a) => [a.id, a.kind]));
  const found = new Map<string, InternalMatch>();

  // 1. Saved on the row.
  for (const t of transactions) {
    if (t.internalKind) found.set(t.id, { kind: t.internalKind, pairId: null, by: 'saved' });
  }

  // 2. Pairs. Ins indexed by amount, so each out looks at its own few.
  const insByAmount = new Map<number, SpendTransaction[]>();
  for (const t of transactions) {
    if (t.amountCents <= 0 || t.pending || found.has(t.id)) continue;
    const list = insByAmount.get(t.amountCents) ?? [];
    list.push(t);
    insByAmount.set(t.amountCents, list);
  }

  const outs = transactions
    .filter((t) => t.amountCents < 0 && !t.pending && !found.has(t.id))
    .filter((t) => OUT_KINDS.has(kindOf.get(t.accountId) as AccountKind))
    .sort((a, b) => a.postedOn.localeCompare(b.postedOn) || a.id.localeCompare(b.id));

  for (const out of outs) {
    const outKind = kindOf.get(out.accountId) as AccountKind;
    let best: SpendTransaction | null = null;
    let bestGap = Infinity;
    for (const candidate of insByAmount.get(-out.amountCents) ?? []) {
      if (found.has(candidate.id) || candidate.accountId === out.accountId) continue;
      if (!kindOf.has(candidate.accountId)) continue;
      if (!readsAsMove(out) && !readsAsMove(candidate)) continue;
      const gap = Math.abs(daysBetween(out.postedOn, candidate.postedOn));
      if (gap > PAIR_WINDOW_DAYS) continue;
      // Nearest first; on a tie, the card, which is where a payment goes.
      const better =
        gap < bestGap ||
        (gap === bestGap && kindOf.get(candidate.accountId) === 'credit_card' && best !== null &&
          kindOf.get(best.accountId) !== 'credit_card');
      if (better) {
        best = candidate;
        bestGap = gap;
      }
    }
    if (!best) continue;
    const kind = kindFor(outKind, kindOf.get(best.accountId) as AccountKind);
    found.set(out.id, { kind, pairId: best.id, by: 'pair' });
    found.set(best.id, { kind, pairId: out.id, by: 'pair' });
  }

  // 3. The category alone.
  const holdsCard = accounts.some((a) => a.kind === 'credit_card');
  for (const t of transactions) {
    if (found.has(t.id) || !t.categoryDetail) continue;
    if (holdsCard && CARD_PAYMENT_DETAILS.has(t.categoryDetail)) {
      found.set(t.id, { kind: 'card_payment', pairId: null, by: 'category' });
    } else if (TRANSFER_DETAILS.has(t.categoryDetail)) {
      found.set(t.id, { kind: 'transfer', pairId: null, by: 'category' });
    }
  }

  return found;
}
