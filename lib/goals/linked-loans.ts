/**
 * Loan balances in Goals from linked loan accounts (plan #2593.8.5).
 *
 * A record in a loans collection keeps the balance an email or a statement
 * gave. Where the record matches a loan account that Plaid keeps up to date
 * (finances.accounts, source plaid), the account's latest balance reading
 * shows instead, so the goal moves without waiting for a statement. A record
 * with no matching linked account keeps its own figure, unchanged.
 *
 * A record matches an account in one of two ways, the first that finds one:
 *   1. a Row-in-the-app field holding `finances.accounts:<account id>`;
 *   2. the collection's ID field, when its value ends with the account's mask
 *      (the last digits Plaid reports) and no other linked loan has that mask.
 *
 * The matching is pure; loadLinkedLoans reads the rows, scoped to one person.
 */

import { idField, liveFields, type CollectionField } from '@/lib/goals/collections';
import type { CollectionInformation, CollectionRecord } from '@/lib/goals/collections-store';

/** One linked loan account with its latest balance, as the match needs it. */
export type LinkedLoan = {
  accountId: string;
  mask: string | null;
  /** The positive amount owed, in cents. */
  balanceCents: number;
  /** The day of the reading. */
  readOn: string;
};

const ACCOUNT_REF = /^finances\.accounts:([A-Za-z0-9_-]{1,100})$/;

/** The money field that holds the balance: the one keyed `balance`, else the first with it in the key. */
export function balanceField(fields: CollectionField[]): CollectionField | null {
  const money = liveFields(fields).filter((f) => f.type === 'money');
  return (
    money.find((f) => f.key === 'balance') ?? money.find((f) => f.key.includes('balance')) ?? null
  );
}

const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The linked loan a record is, or null. */
export function matchLoan(
  fields: CollectionField[],
  data: CollectionRecord['data'],
  loans: LinkedLoan[],
): LinkedLoan | null {
  for (const f of liveFields(fields)) {
    if (f.type !== 'ref') continue;
    const value = data[f.key];
    const id = typeof value === 'string' ? ACCOUNT_REF.exec(value)?.[1] : undefined;
    const hit = id ? loans.find((l) => l.accountId === id) : undefined;
    if (hit) return hit;
  }
  const idf = idField(fields);
  const raw = idf ? data[idf.key] : null;
  const key = raw === null || raw === undefined ? '' : alnum(String(raw));
  if (!key) return null;
  const hits = loans.filter((l) => {
    const mask = l.mask ? alnum(l.mask) : '';
    return mask.length >= 2 && key.endsWith(mask);
  });
  return hits.length === 1 ? hits[0] : null;
}

/**
 * The collections with each matching record's balance replaced by its linked
 * account's latest reading. Records and collections without a match are
 * returned as they were.
 */
export function applyLinkedLoans(
  information: Record<string, CollectionInformation>,
  loans: LinkedLoan[],
): Record<string, CollectionInformation> {
  if (loans.length === 0) return information;
  const out: Record<string, CollectionInformation> = {};
  for (const [id, info] of Object.entries(information)) {
    const field = balanceField(info.collection.fields);
    if (!field) {
      out[id] = info;
      continue;
    }
    out[id] = {
      ...info,
      records: info.records.map((record) => {
        const loan = matchLoan(info.collection.fields, record.data, loans);
        if (!loan) return record;
        return {
          ...record,
          data: { ...record.data, [field.key]: Math.round(loan.balanceCents) / 100 },
          linkedBalance: { accountId: loan.accountId, readOn: loan.readOn },
        };
      }),
    };
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = import('@supabase/supabase-js').SupabaseClient<any, any, any>;

/**
 * The person's open Plaid loan accounts with their latest balance reading.
 * An account with no reading is left out, so its record keeps its own figure.
 */
export async function loadLinkedLoans(client: Client, userId: string): Promise<LinkedLoan[]> {
  const accounts = await client
    .schema('finances')
    .from('accounts')
    .select('id, mask')
    .eq('user_id', userId)
    .eq('kind', 'loan')
    .eq('source', 'plaid')
    .is('closed_on', null);
  if (accounts.error) throw new Error(`Reading loan accounts failed: ${accounts.error.message}`);
  const rows = (accounts.data ?? []) as { id: string; mask: string | null }[];
  if (rows.length === 0) return [];
  const readings = await client
    .schema('finances')
    .from('balance_readings')
    .select('account_id, read_on, balance_cents')
    .eq('user_id', userId)
    .in(
      'account_id',
      rows.map((r) => r.id),
    )
    .order('read_on', { ascending: false })
    .limit(1000);
  if (readings.error) throw new Error(`Reading loan balances failed: ${readings.error.message}`);
  const latest = new Map<string, { readOn: string; cents: number }>();
  for (const r of (readings.data ?? []) as {
    account_id: string;
    read_on: string;
    balance_cents: number | string;
  }[]) {
    if (!latest.has(r.account_id))
      latest.set(r.account_id, { readOn: r.read_on, cents: Number(r.balance_cents) });
  }
  return rows.flatMap((a) => {
    const reading = latest.get(a.id);
    return reading
      ? [{ accountId: a.id, mask: a.mask, balanceCents: reading.cents, readOn: reading.readOn }]
      : [];
  });
}

/**
 * The same, for a page: a failed read leaves every record on its own figure
 * rather than taking the goal page down.
 */
export async function loadLinkedLoansOrNone(client: Client, userId: string): Promise<LinkedLoan[]> {
  try {
    return await loadLinkedLoans(client, userId);
  } catch {
    return [];
  }
}
