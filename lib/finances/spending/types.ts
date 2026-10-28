/**
 * The shapes Spending reads from finances.accounts and finances.transactions
 * (plan #2593.7), as plain data so the rules in this folder are tested
 * without a database and the gallery draws them from fixtures.
 */

export type AccountKind = 'checking' | 'savings' | 'credit_card' | 'brokerage' | 'loan';

/** Money that only moved between two of the person's own accounts. */
export type InternalKind = 'card_payment' | 'transfer';

export interface SpendAccount {
  id: string;
  name: string;
  kind: AccountKind;
  /** Hidden from totals and lists; still read for matching transfers. */
  hidden: boolean;
  mask: string | null;
}

export interface SpendTransaction {
  id: string;
  accountId: string;
  /** Positive for money into the account, negative for money out. */
  amountCents: number;
  /** YYYY-MM-DD. */
  postedOn: string;
  description: string;
  merchant: string | null;
  category: string | null;
  categoryDetail: string | null;
  pending: boolean;
  orderId: string | null;
  recurringPaymentId: string | null;
  /** What finances.transactions.internal_kind holds, saved or set by the person. */
  internalKind: InternalKind | null;
}

/** A Shopping order, as the charge matcher reads it. */
export interface MatchOrder {
  id: string;
  /** YYYY-MM-DD. */
  orderDate: string;
  totalCents: number;
  merchantName: string | null;
  cancelled: boolean;
}
