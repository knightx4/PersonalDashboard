import type { DevComment } from '@/lib/comments/load';
import { FINANCES_SCHEMA } from '@/lib/finances/db/schema-name';
import { loadThread } from '@/lib/thread/store';
import { threadRef } from '@/lib/thread/subjects';
import {
  accountIdsOf,
  firstReview,
  MONTH_REVIEW_COLUMNS,
  showReview,
  storedLines,
  transactionIdsOf,
  type MonthReviewRecord,
  type ReviewCharge,
  type ReviewPanel,
} from './show';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = import('@supabase/supabase-js').SupabaseClient<any, any, any>;

/** Ids per read; a longer list would overflow the request's URL. */
const IDS_PER_READ = 100;

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let at = 0; at < items.length; at += IDS_PER_READ)
    out.push(items.slice(at, at + IDS_PER_READ));
  return out;
}

type ChargeRow = {
  id: string;
  account_id: string;
  posted_on: string;
  description: string;
  merchant: string | null;
  amount_cents: number;
  pending: boolean;
};

export type ReviewPanelData = { panel: ReviewPanel; thread: DevComment[] };

/**
 * The top of Finances (plan #2593.8.3): the person's newest monthly review
 * with the transactions and accounts its lines name, and its thread. With
 * no review yet it says when the first comes; with no accounts it is
 * nothing, since the page's own empty state says what to do first.
 *
 * Read with the person's own client, which row level security keeps in their
 * account, and every read names them as well. The lines keep transaction
 * ids as plain uuids with no foreign key, so a charge deleted since is
 * simply not found.
 */
export async function loadReviewPanel(
  client: Client,
  userId: string,
  today: string,
  hasAccounts: boolean,
): Promise<ReviewPanelData> {
  if (!hasAccounts) return { panel: null, thread: [] };
  const db = client.schema(FINANCES_SCHEMA);
  const { data, error } = await db
    .from('month_reviews')
    .select(MONTH_REVIEW_COLUMNS)
    .eq('user_id', userId)
    .order('month', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Reading the month's review failed: ${error.message}`);
  if (!data) return { panel: { kind: 'first', ...firstReview(today) }, thread: [] };

  const record = data as MonthReviewRecord;
  const lines = storedLines(record.lines);
  const transactionIds = transactionIdsOf(lines);
  const accountIds = accountIdsOf(lines);

  const [chargeRows, accountRows, thread] = await Promise.all([
    Promise.all(
      chunks(transactionIds).map(async (ids) => {
        const { data: rows, error: readError } = await db
          .from('transactions')
          .select('id, account_id, posted_on, description, merchant, amount_cents, pending')
          .eq('user_id', userId)
          .in('id', ids);
        if (readError) throw new Error(`Reading the review's charges failed: ${readError.message}`);
        return (rows ?? []) as ChargeRow[];
      }),
    ),
    accountIds.length === 0
      ? Promise.resolve([] as { id: string; name: string; mask: string | null }[])
      : db
          .from('accounts')
          .select('id, name, mask')
          .eq('user_id', userId)
          .in('id', accountIds)
          .then(({ data: rows, error: readError }) => {
            if (readError)
              throw new Error(`Reading the review's accounts failed: ${readError.message}`);
            return (rows ?? []) as { id: string; name: string; mask: string | null }[];
          }),
    // A failed read leaves the thread empty rather than the review missing.
    loadThread(client, threadRef('review', record.id), { userId }).catch(() => [] as DevComment[]),
  ]);

  const charges = new Map<string, ReviewCharge>(
    chargeRows.flat().map((row) => [
      row.id,
      {
        id: row.id,
        accountId: row.account_id,
        postedOn: row.posted_on,
        name: row.merchant?.trim() || row.description,
        amountCents: Number(row.amount_cents),
        pending: row.pending,
      },
    ]),
  );
  const accounts = new Map(accountRows.map((a) => [a.id, a]));
  return { panel: { kind: 'review', review: showReview(record, charges, accounts) }, thread };
}
