import 'server-only';

import { createServiceSupabase } from '@/inngest/supabase-admin';
import { decryptToken } from '@/lib/crypto/tokens';
import { syncPort } from '@/lib/finances/plaid/client';
import { isPlaidConfigured, plaidEnv } from '@/lib/finances/plaid/env';
import { createFinancesServiceClient, listSyncLinks, syncStore } from '@/lib/finances/plaid/store';
import { syncLink, type SyncDeps, type SyncLink, type SyncResult } from '@/lib/finances/plaid/sync';
import { todayInTimezone } from '@/lib/money';

/**
 * The Plaid sync's runner (plan #2593.4): every live link each morning, from
 * the daily cron, and one link when its webhook says Plaid has news. The
 * rules are in lib/finances/plaid/sync.ts.
 *
 * Links run one after another, so a person's few Items take a few seconds
 * each and one link's failure is recorded on that link without stopping the
 * rest.
 */

function deps(): SyncDeps {
  const env = plaidEnv();
  const db = createFinancesServiceClient();
  return {
    plaid: syncPort(),
    decrypt: (cipher) => decryptToken(cipher, env.TOKEN_ENCRYPTION_KEY),
    store: {
      ...syncStore(db),
      async writeDevNote(userId, body) {
        const { data, error } = await createServiceSupabase()
          .from('feedback_items')
          .insert({ user_id: userId, kind: 'bug', body, page_path: '/finances/settings' })
          .select('id')
          .single();
        if (error || !data?.id) throw new Error(`Writing the Dev note failed: ${error?.message ?? 'no id'}`);
        return String(data.id);
      },
    },
  };
}

/** Each person's own day, from their profile, for the balance reading's date. */
async function todays(userIds: string[], now: Date): Promise<Map<string, string>> {
  const days = new Map<string, string>();
  if (userIds.length === 0) return days;
  const { data } = await createServiceSupabase().from('profiles').select('id, timezone').in('id', userIds);
  for (const p of (data ?? []) as { id: string; timezone: string | null }[]) {
    days.set(p.id, todayInTimezone(p.timezone || 'UTC', now));
  }
  return days;
}

async function run(links: SyncLink[]): Promise<Record<string, SyncResult>> {
  const now = new Date();
  const days = await todays([...new Set(links.map((l) => l.user_id))], now);
  const d = deps();
  const results: Record<string, SyncResult> = {};
  for (const link of links) {
    results[`${link.institution_name} (${link.id.slice(0, 8)})`] = await syncLink(d, link, {
      today: days.get(link.user_id) ?? todayInTimezone('UTC', now),
      now: now.toISOString(),
    });
  }
  return results;
}

/** The morning run: every live link. Does nothing until Plaid's keys are set. */
export async function runPlaidSyncForAll(): Promise<{ skipped: string } | Record<string, SyncResult>> {
  if (!isPlaidConfigured()) return { skipped: 'Plaid is not configured' };
  return run(await listSyncLinks());
}

/** One link, when Plaid's webhook says it has new transactions, holdings or liabilities. */
export async function runPlaidSyncForLink(linkId: string): Promise<Record<string, SyncResult>> {
  if (!isPlaidConfigured()) return {};
  return run(await listSyncLinks(undefined, { linkId }));
}
