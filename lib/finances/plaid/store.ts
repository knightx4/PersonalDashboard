import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { publicEnv } from '@/lib/env';
import { FINANCES_SCHEMA, type FinancesSupabaseClient } from '@/lib/finances/db/schema-name';
import type { AccountKind, LinkStore, StoredLink } from './link';
import type { SyncLink, SyncStore } from './sync';

/**
 * SERVICE-ROLE CLIENT FOR THE FINANCES SCHEMA. It bypasses RLS, so every
 * query made through it names the user whose rows it touches.
 *
 * finances.links is written only here: the signed-in person's client can
 * neither insert a link nor read its access token (migrations-finances/0001).
 * Callers are the settings actions, which pass the signed-in user's id, and
 * the Plaid webhook, which finds the user by the Item's id.
 */
export function createFinancesServiceClient(): FinancesSupabaseClient {
  if (typeof window !== 'undefined') throw new Error('createFinancesServiceClient is server-only');
  const { SUPABASE_SERVICE_ROLE_KEY } = z
    .object({ SUPABASE_SERVICE_ROLE_KEY: z.string().min(1) })
    .parse(process.env);
  return createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: FINANCES_SCHEMA },
  });
}

export function linkStore(db: FinancesSupabaseClient = createFinancesServiceClient()): LinkStore {
  return {
    async listLinks(userId) {
      const { data, error } = await db
        .from('links')
        .select('id, plaid_item_id, institution_id, institution_name, status, needs_update, access_token')
        .eq('user_id', userId)
        .order('created_at');
      if (error) throw new Error(error.message);
      return (data ?? []) as StoredLink[];
    },
    async insertLink(row) {
      const { data, error } = await db.from('links').insert(row).select('id').single();
      if (error) throw new Error(error.message);
      return { id: (data as { id: string }).id };
    },
    async updateLink(userId, linkId, patch) {
      const { error } = await db.from('links').update(patch).eq('user_id', userId).eq('id', linkId);
      if (error) throw new Error(error.message);
    },
    async saveAccounts(userId, accounts, balances) {
      if (accounts.length === 0) return 0;
      const { data, error } = await db
        .from('accounts')
        .upsert(accounts, { onConflict: 'user_id,plaid_account_id' })
        .select('id, plaid_account_id');
      if (error) throw new Error(error.message);
      const ids = new Map(
        ((data ?? []) as { id: string; plaid_account_id: string }[]).map((r) => [r.plaid_account_id, r.id]),
      );
      const readings = balances.flatMap((b) => {
        const accountId = ids.get(b.plaid_account_id);
        if (!accountId) return [];
        return [
          {
            user_id: userId,
            account_id: accountId,
            read_on: b.read_on,
            balance_cents: b.balance_cents,
            available_cents: b.available_cents,
          },
        ];
      });
      if (readings.length > 0) {
        const { error: readingError } = await db
          .from('balance_readings')
          .upsert(readings, { onConflict: 'account_id,read_on' });
        if (readingError) throw new Error(readingError.message);
      }
      return ids.size;
    },
  };
}

/** The link columns a sync reads. */
const SYNC_LINK_COLUMNS =
  'id, user_id, institution_name, access_token, sync_cursor, needs_update, failing_since, failure_noted_on';

/**
 * The links a sync runs over: every live link, or the one named. Across all
 * the app's accounts for the morning run; each link's rows are written under
 * its own user_id.
 */
export async function listSyncLinks(
  db: FinancesSupabaseClient = createFinancesServiceClient(),
  only?: { linkId: string },
): Promise<SyncLink[]> {
  let query = db.from('links').select(SYNC_LINK_COLUMNS).neq('status', 'removed');
  if (only) query = query.eq('id', only.linkId);
  const { data, error } = await query.order('created_at');
  if (error) throw new Error(error.message);
  return (data ?? []) as SyncLink[];
}

/** A sync's database writes, except the Dev note, which the runner adds. */
export function syncStore(db: FinancesSupabaseClient = createFinancesServiceClient()): Omit<SyncStore, 'writeDevNote'> {
  const links = linkStore(db);
  const fail = (error: { message: string } | null) => {
    if (error) throw new Error(error.message);
  };
  return {
    saveAccounts: links.saveAccounts,
    async accountIds(userId, linkId) {
      const { data, error } = await db
        .from('accounts')
        .select('id, plaid_account_id, kind')
        .eq('user_id', userId)
        .eq('link_id', linkId);
      fail(error);
      return new Map(
        ((data ?? []) as { id: string; plaid_account_id: string; kind: AccountKind }[]).map((a) => [
          a.plaid_account_id,
          { id: a.id, kind: a.kind },
        ]),
      );
    },
    async existingTransactions(userId, plaidIds) {
      const found = new Set<string>();
      for (let i = 0; i < plaidIds.length; i += 200) {
        const { data, error } = await db
          .from('transactions')
          .select('plaid_transaction_id')
          .eq('user_id', userId)
          .in('plaid_transaction_id', plaidIds.slice(i, i + 200));
        fail(error);
        for (const r of (data ?? []) as { plaid_transaction_id: string }[]) found.add(r.plaid_transaction_id);
      }
      return found;
    },
    async renameTransaction(userId, fromPlaidId, toPlaidId) {
      const { error } = await db
        .from('transactions')
        .update({ plaid_transaction_id: toPlaidId })
        .eq('user_id', userId)
        .eq('plaid_transaction_id', fromPlaidId);
      fail(error);
    },
    async upsertTransactions(rows) {
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await db
          .from('transactions')
          .upsert(rows.slice(i, i + 500), { onConflict: 'user_id,plaid_transaction_id' });
        fail(error);
      }
    },
    async deleteTransactions(userId, plaidIds) {
      for (let i = 0; i < plaidIds.length; i += 200) {
        const { error } = await db
          .from('transactions')
          .delete()
          .eq('user_id', userId)
          .in('plaid_transaction_id', plaidIds.slice(i, i + 200));
        fail(error);
      }
    },
    async updateAccountDetails(userId, accountId, details) {
      const { error } = await db.from('accounts').update(details).eq('user_id', userId).eq('id', accountId);
      fail(error);
    },
    async upsertHoldings(rows) {
      const { error } = await db.from('holdings').upsert(rows, { onConflict: 'account_id,as_of,security_key' });
      fail(error);
    },
    async updateLink(userId, linkId, patch) {
      const { error } = await db.from('links').update(patch).eq('user_id', userId).eq('id', linkId);
      fail(error);
    },
    async markEventsHandled(userId, linkId, upTo) {
      const { error } = await db
        .from('plaid_events')
        .update({ handled_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('link_id', linkId)
        .is('handled_at', null)
        .lte('received_at', upTo);
      fail(error);
    },
  };
}
