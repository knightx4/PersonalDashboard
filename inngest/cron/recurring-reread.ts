import 'server-only';

import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createServiceSupabase } from '@/inngest/supabase-admin';
import { ensureAccessToken, loadAccount } from '@/lib/core/inbox/sync-account';
import { gmailOAuthEnv } from '@/lib/email/gmail-env';
import { gmailProvider } from '@/lib/email/providers/gmail';
import { rereadStoreReceipts, type RereadResult } from '@/lib/recurring/reread';

/**
 * The nightly stage that re-reads receipts filed under a store's name
 * (plan #1212; the pass is lib/recurring/reread.ts). It runs per connected
 * mailbox, because a Gmail id only means something to the account it came
 * from. The token is fetched only when there is a message to read, so once
 * nothing is left under "Apple" a night costs one query per account.
 */
export async function runRecurringReread(): Promise<
  { accounts: number } & { [accountId: string]: RereadResult | number | { error: string } }
> {
  const core = createCoreServiceSupabase();
  const supabase = createServiceSupabase();

  const { data: accounts, error } = await core
    .from('email_accounts')
    .select('id, user_id')
    .eq('status', 'active');
  if (error) throw new Error(error.message);

  const summary: { accounts: number } & {
    [accountId: string]: RereadResult | number | { error: string };
  } = { accounts: accounts?.length ?? 0 };

  for (const row of (accounts ?? []) as { id: string; user_id: string }[]) {
    let token: string | null = null;
    const accessToken = async () => {
      if (token) return token;
      const account = await loadAccount(core, row.user_id, row.id);
      token = await ensureAccessToken(core, account, gmailOAuthEnv().TOKEN_ENCRYPTION_KEY);
      return token;
    };
    try {
      summary[row.id] = await rereadStoreReceipts(supabase, {
        userId: row.user_id,
        providerIds: async (ids) => {
          if (ids.length === 0) return new Map();
          const { data, error: lookupError } = await core
            .from('ingested_messages')
            .select('id, provider_message_id')
            // The account is the person's; ingested_messages has no user_id.
            .eq('email_account_id', row.id)
            .in('id', ids);
          if (lookupError) throw new Error(lookupError.message);
          return new Map(
            (data ?? []).map((m) => [m.id as string, m.provider_message_id as string]),
          );
        },
        fetchMessage: async (providerMessageId) => {
          const message = await gmailProvider.getMessage(await accessToken(), providerMessageId, {
            format: 'full',
          });
          return {
            subject: message.subject ?? '',
            text: message.text,
            fromAddress: message.fromAddress,
          };
        },
      });
    } catch (err) {
      summary[row.id] = { error: err instanceof Error ? err.message : 'failed' };
    }
  }
  return summary;
}
