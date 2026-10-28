import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { publicEnv } from '@/lib/env';
import { FINANCES_SCHEMA, type FinancesSupabaseClient } from '@/lib/finances/db/schema-name';
import type { LinkStore, StoredLink } from './link';

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
