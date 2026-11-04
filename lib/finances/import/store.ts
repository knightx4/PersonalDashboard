import { FINANCES_SCHEMA } from '../db/schema-name';
import type { AccountKind } from '../accounts';
import { impliedClosingBalance, type WalletStatement } from './wallet';

/**
 * Writing imported statements and hand-kept accounts (plan #2593.5). Every
 * read and write names the person, so a service-role client stays in their
 * account too. Kept free of server-only imports so it can be called with any
 * client.
 *
 * An imported or manual account never carries a link or a Plaid id
 * (accounts_plaid_ck, accounts_link_source_ck), and its balance arrives as one
 * reading a statement or a typed update, upserted on (account_id, read_on).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = import('@supabase/supabase-js').SupabaseClient<any, any, any>;

/** The account Apple Card statements go into: the first imported Apple card. */
export const APPLE_CARD = { name: 'Apple Card', institutionName: 'Apple' } as const;

async function findAppleCard(client: Client, userId: string): Promise<string | null> {
  const { data, error } = await client
    .schema(FINANCES_SCHEMA)
    .from('accounts')
    .select('id')
    .eq('user_id', userId)
    .eq('source', 'import')
    .eq('kind', 'credit_card')
    .eq('institution_name', APPLE_CARD.institutionName)
    .order('created_at')
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Reading the Apple Card account failed: ${error.message}`);
  return (data as { id: string } | null)?.id ?? null;
}

/** The fingerprints of these lines already on the account. */
async function knownFingerprints(
  client: Client,
  userId: string,
  accountId: string,
  fingerprints: readonly string[],
): Promise<Set<string>> {
  const known = new Set<string>();
  // A month is a few hundred lines at most; chunks keep the URL short.
  for (let i = 0; i < fingerprints.length; i += 100) {
    const { data, error } = await client
      .schema(FINANCES_SCHEMA)
      .from('transactions')
      .select('import_fingerprint')
      .eq('user_id', userId)
      .eq('account_id', accountId)
      .in('import_fingerprint', fingerprints.slice(i, i + 100));
    if (error) throw new Error(`Reading imported transactions failed: ${error.message}`);
    for (const row of (data ?? []) as { import_fingerprint: string }[])
      known.add(row.import_fingerprint);
  }
  return known;
}

/** The newest balance read before `day`, as the opening of a statement closing after it. */
async function balanceBefore(
  client: Client,
  userId: string,
  accountId: string,
  day: string,
): Promise<number | null> {
  const { data, error } = await client
    .schema(FINANCES_SCHEMA)
    .from('balance_readings')
    .select('balance_cents')
    .eq('user_id', userId)
    .eq('account_id', accountId)
    .lt('read_on', day)
    .order('read_on', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Reading the last balance failed: ${error.message}`);
  return data ? Number((data as { balance_cents: number | string }).balance_cents) : null;
}

export type ImportPreview = {
  /** The Apple Card account, or null when the first import will create it. */
  accountId: string | null;
  format: WalletStatement['format'];
  count: number;
  /** Lines not on the account yet: what the import adds. */
  newCount: number;
  from: string | null;
  to: string | null;
  closingOn: string | null;
  /** From the file (OFX), or worked out from the last statement's balance (CSV); null when neither. */
  closingBalanceCents: number | null;
  /** Where that balance came from. */
  closingFrom: 'file' | 'worked out' | null;
};

/** What importing this statement would add, before anything is written. */
export async function previewStatement(
  client: Client,
  userId: string,
  statement: WalletStatement,
): Promise<ImportPreview> {
  const accountId = await findAppleCard(client, userId);
  const known = accountId
    ? await knownFingerprints(
        client,
        userId,
        accountId,
        statement.lines.map((l) => l.fingerprint),
      )
    : new Set<string>();
  let closingBalanceCents = statement.closingBalanceCents;
  let closingFrom: ImportPreview['closingFrom'] = closingBalanceCents === null ? null : 'file';
  if (closingBalanceCents === null && accountId && statement.from) {
    closingBalanceCents = impliedClosingBalance(
      statement.lines,
      await balanceBefore(client, userId, accountId, statement.from),
    );
    if (closingBalanceCents !== null) closingFrom = 'worked out';
  }
  return {
    accountId,
    format: statement.format,
    count: statement.lines.length,
    newCount: statement.lines.filter((l) => !known.has(l.fingerprint)).length,
    from: statement.from,
    to: statement.to,
    closingOn: statement.closingOn,
    closingBalanceCents,
    closingFrom,
  };
}

export type ImportResult = { accountId: string; added: number; skipped: number };

/**
 * Writes a statement into the Apple Card account, creating the account on
 * the first import. A line already imported lands on its fingerprint and is
 * left as it is, so importing a month twice adds nothing the second time.
 * The closing balance is the reading on the statement's closing day, and the
 * card's statement balance when it is the newest statement.
 */
export async function importStatement(
  client: Client,
  userId: string,
  statement: WalletStatement,
  closingBalanceCents: number | null,
): Promise<ImportResult> {
  const db = client.schema(FINANCES_SCHEMA);
  let accountId = await findAppleCard(client, userId);
  if (!accountId) {
    const { data, error } = await db
      .from('accounts')
      .insert({
        user_id: userId,
        name: APPLE_CARD.name,
        institution_name: APPLE_CARD.institutionName,
        kind: 'credit_card',
        source: 'import',
      })
      .select('id')
      .single();
    if (error) throw new Error(`Adding the Apple Card account failed: ${error.message}`);
    accountId = (data as { id: string }).id;
  }

  let added = 0;
  for (let i = 0; i < statement.lines.length; i += 500) {
    const rows = statement.lines.slice(i, i + 500).map((l) => ({
      user_id: userId,
      account_id: accountId,
      amount_cents: l.amountCents,
      posted_on: l.postedOn,
      authorized_on: l.authorizedOn,
      description: l.description,
      merchant: l.merchant,
      category: l.category,
      category_detail: l.categoryDetail,
      import_fingerprint: l.fingerprint,
    }));
    const { data, error } = await db
      .from('transactions')
      .upsert(rows, { onConflict: 'account_id,import_fingerprint', ignoreDuplicates: true })
      .select('id');
    if (error) throw new Error(`Adding the transactions failed: ${error.message}`);
    added += (data ?? []).length;
  }

  if (closingBalanceCents !== null && statement.closingOn) {
    const { data: newest, error: newestError } = await db
      .from('balance_readings')
      .select('read_on')
      .eq('user_id', userId)
      .eq('account_id', accountId)
      .order('read_on', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (newestError) throw new Error(`Reading the last balance failed: ${newestError.message}`);
    await upsertReading(client, userId, accountId, closingBalanceCents, statement.closingOn);
    const latest = (newest as { read_on: string } | null)?.read_on;
    if (!latest || statement.closingOn >= latest) {
      const { error } = await db
        .from('accounts')
        .update({ statement_balance_cents: closingBalanceCents, last_statement_on: statement.closingOn })
        .eq('user_id', userId)
        .eq('id', accountId);
      if (error) throw new Error(`Saving the statement balance failed: ${error.message}`);
    }
  }

  return { accountId, added, skipped: statement.lines.length - added };
}

async function upsertReading(
  client: Client,
  userId: string,
  accountId: string,
  balanceCents: number,
  readOn: string,
): Promise<void> {
  const { error } = await client
    .schema(FINANCES_SCHEMA)
    .from('balance_readings')
    .upsert(
      { user_id: userId, account_id: accountId, read_on: readOn, balance_cents: balanceCents },
      { onConflict: 'account_id,read_on' },
    );
  if (error) throw new Error(`Saving the balance failed: ${error.message}`);
}

/** The kinds an account added by hand may be. */
export const MANUAL_KINDS: readonly AccountKind[] = [
  'checking',
  'savings',
  'credit_card',
  'brokerage',
  'loan',
];

export type ManualAccount = {
  name: string;
  kind: AccountKind;
  institutionName: string | null;
  balanceCents: number;
  readOn: string;
};

/** Adds an account kept by hand, with its first balance. */
export async function addManualAccount(
  client: Client,
  userId: string,
  account: ManualAccount,
): Promise<string> {
  const { data, error } = await client
    .schema(FINANCES_SCHEMA)
    .from('accounts')
    .insert({
      user_id: userId,
      name: account.name,
      kind: account.kind,
      institution_name: account.institutionName,
      source: 'manual',
    })
    .select('id')
    .single();
  if (error) throw new Error(`Adding the account failed: ${error.message}`);
  const id = (data as { id: string }).id;
  await upsertReading(client, userId, id, account.balanceCents, account.readOn);
  return id;
}

/**
 * A new balance for an account kept by hand or by statement. A linked
 * account's balances come from Plaid and a Goals loan's from its row in
 * Goals, so neither takes one here.
 */
export async function addBalanceReading(
  client: Client,
  userId: string,
  accountId: string,
  balanceCents: number,
  readOn: string,
): Promise<boolean> {
  const { data, error } = await client
    .schema(FINANCES_SCHEMA)
    .from('accounts')
    .select('id')
    .eq('user_id', userId)
    .eq('id', accountId)
    .in('source', ['manual', 'import'])
    .maybeSingle();
  if (error) throw new Error(`Reading the account failed: ${error.message}`);
  if (!data) return false;
  await upsertReading(client, userId, accountId, balanceCents, readOn);
  return true;
}
