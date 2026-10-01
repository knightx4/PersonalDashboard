import 'server-only';

import { decryptToken, encryptToken } from '@/lib/crypto/tokens';
import { gmailProvider } from '@/lib/email/providers/gmail';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';

/**
 * A connected mailbox's row and a usable Gmail token for it.
 *
 * The sync and the live mail search both need these, and they need them to
 * behave the same way: decrypt the stored token, refresh it when under a
 * minute is left, write the new one back, and mark the mailbox `needs_reauth`
 * when Google refuses the refresh.
 */

export type AccountRow = {
  id: string;
  user_id: string;
  email_address: string;
  oauth_refresh_token: string | null;
  oauth_access_token: string | null;
  token_expires_at: string | null;
  backfill_window_days: number;
  sync_cursor: string | null;
  last_synced_at: string | null;
  status: string;
};

export const ACCOUNT_COLUMNS =
  'id, user_id, email_address, oauth_refresh_token, oauth_access_token, token_expires_at, backfill_window_days, sync_cursor, last_synced_at, status';

export async function loadAccount(
  supabase: CoreSupabaseClient,
  userId: string,
  accountId: string,
): Promise<AccountRow> {
  const { data, error } = await supabase
    .from('email_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('id', accountId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) throw new Error('Inbox not found.');
  return data as AccountRow;
}

/**
 * A valid access token, refreshing if the stored one has expired.
 *
 * One grant now serves both workspaces, so this is also the single place a
 * revoked token turns into `needs_reauth` -- previously each app discovered
 * that separately and told the user separately.
 */
export async function ensureAccessToken(
  supabase: CoreSupabaseClient,
  account: AccountRow,
  encryptionKey: string,
): Promise<string> {
  if (!account.oauth_refresh_token) {
    throw new Error('Inbox has no refresh token — reconnect Gmail.');
  }

  const refresh = decryptToken(account.oauth_refresh_token, encryptionKey);
  const expiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  const stillValid =
    account.oauth_access_token && expiresAt - Date.now() > 60_000
      ? decryptToken(account.oauth_access_token, encryptionKey)
      : null;

  if (stillValid) return stillValid;

  try {
    const tokens = await gmailProvider.refreshAccessToken(refresh);
    await supabase
      .from('email_accounts')
      .update({
        oauth_access_token: encryptToken(tokens.accessToken, encryptionKey),
        oauth_refresh_token: encryptToken(tokens.refreshToken ?? refresh, encryptionKey),
        token_expires_at: tokens.expiresAt?.toISOString() ?? null,
        status: 'active',
      })
      .eq('id', account.id)
      .eq('user_id', account.user_id);
    return tokens.accessToken;
  } catch (err) {
    await supabase
      .from('email_accounts')
      .update({ status: 'needs_reauth' })
      .eq('id', account.id)
      .eq('user_id', account.user_id);
    throw err;
  }
}
