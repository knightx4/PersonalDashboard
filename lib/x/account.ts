import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptToken, encryptToken } from '@/lib/crypto/tokens';
import { refreshXTokens, XOAuthError, type XClient, type XTokens } from './oauth';

/**
 * The connected X account (public.x_accounts, plan #1817) as the Posts tab
 * and the reads use it (plan #1818).
 *
 * `freshXAccessToken` is the one place a token is refreshed. X rotates the
 * refresh token on every refresh, so the new pair is written back before the
 * access token is handed out, and a refresh X refuses marks the account
 * disconnected so the tab offers Connect again.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export type XAccountRow = {
  id: string;
  user_id: string;
  x_user_id: string;
  handle: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  status: 'active' | 'disconnected';
  last_synced_at: string | null;
  newest_post_id: string | null;
  read_problem: string | null;
  created_at: string;
};

export const X_ACCOUNT_COLUMNS =
  'id, user_id, x_user_id, handle, access_token, refresh_token, token_expires_at, status, last_synced_at, newest_post_id, read_problem, created_at';

export async function loadXAccount(db: Db, userId: string): Promise<XAccountRow | null> {
  const { data, error } = await db
    .from('x_accounts')
    .select(X_ACCOUNT_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the X connection: ${error.message}`);
  return (data as XAccountRow | null) ?? null;
}

/** The row's columns for a fresh sign-in, tokens encrypted. */
export function xAccountWrite(input: {
  xUserId: string;
  handle: string;
  tokens: XTokens;
  encryptionKey: string;
}) {
  return {
    x_user_id: input.xUserId,
    handle: input.handle,
    access_token: encryptToken(input.tokens.accessToken, input.encryptionKey),
    refresh_token: input.tokens.refreshToken
      ? encryptToken(input.tokens.refreshToken, input.encryptionKey)
      : null,
    token_expires_at: input.tokens.expiresAt?.toISOString() ?? null,
    status: 'active' as const,
  };
}

/** What the Posts tab shows about the connection. */
export type XConnectionView =
  | { state: 'unconfigured'; setupStep: number }
  | { state: 'none' }
  | { state: 'connected'; handle: string; lastSyncedAt: string | null; problem?: string | null }
  | { state: 'disconnected'; handle: string };

export function xConnectionView(
  row: (Pick<XAccountRow, 'handle' | 'status' | 'last_synced_at'> & { read_problem?: string | null }) | null,
  configured: boolean,
  setupStep: number,
): XConnectionView {
  // A row left from before the keys were taken away still cannot be used, so
  // the missing keys win: they are what the person has to fix first.
  if (!configured) return { state: 'unconfigured', setupStep };
  if (!row) return { state: 'none' };
  if (row.status === 'disconnected') return { state: 'disconnected', handle: row.handle };
  return {
    state: 'connected',
    handle: row.handle,
    lastSyncedAt: row.last_synced_at,
    problem: row.read_problem ?? null,
  };
}

/** Thrown when the account cannot be read until the person connects again. */
export class XDisconnectedError extends Error {
  constructor(message = 'X stopped accepting the sign-in. Connect X again on the Posts tab.') {
    super(message);
    this.name = 'XDisconnectedError';
  }
}

/** Refresh when less than this is left on the access token. */
export const X_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * A usable access token for the account, refreshing it when under five
 * minutes are left and writing the rotated pair back.
 *
 * A refresh X refuses (a 4xx: the grant was revoked or the refresh token is
 * spent) marks the row disconnected and throws XDisconnectedError. A network
 * failure or a 5xx throws as it is and leaves the row active, since the
 * sign-in may well still be good.
 *
 * Two refreshes at once would each spend the same refresh token and the
 * second would be refused, so callers run one read per account at a time.
 */
export async function freshXAccessToken(
  db: Db,
  account: XAccountRow,
  opts: { client: XClient; encryptionKey: string; fetchImpl?: typeof fetch; now?: number },
): Promise<string> {
  const now = opts.now ?? Date.now();
  if (account.status === 'disconnected') throw new XDisconnectedError();

  const expiresAt = account.token_expires_at ? Date.parse(account.token_expires_at) : 0;
  if (account.access_token && expiresAt - now > X_REFRESH_MARGIN_MS) {
    return decryptToken(account.access_token, opts.encryptionKey);
  }

  const markDisconnected = async () => {
    await db
      .from('x_accounts')
      .update({ status: 'disconnected', access_token: null, refresh_token: null, token_expires_at: null })
      .eq('id', account.id)
      .eq('user_id', account.user_id);
  };

  if (!account.refresh_token) {
    await markDisconnected();
    throw new XDisconnectedError();
  }

  const refresh = decryptToken(account.refresh_token, opts.encryptionKey);
  let tokens: XTokens;
  try {
    tokens = await refreshXTokens(opts.client, refresh, opts.fetchImpl, now);
  } catch (err) {
    if (err instanceof XOAuthError && err.status >= 400 && err.status < 500) {
      await markDisconnected();
      throw new XDisconnectedError();
    }
    throw err;
  }

  const { error } = await db
    .from('x_accounts')
    .update({
      access_token: encryptToken(tokens.accessToken, opts.encryptionKey),
      refresh_token: encryptToken(tokens.refreshToken ?? refresh, opts.encryptionKey),
      token_expires_at: tokens.expiresAt?.toISOString() ?? null,
      status: 'active',
    })
    .eq('id', account.id)
    .eq('user_id', account.user_id);
  if (error) throw new Error(`Could not store the refreshed X sign-in: ${error.message}`);
  return tokens.accessToken;
}

export type XConnectNotice = { tone: 'ok' | 'problem'; text: string };

/**
 * The line the tab shows after a round trip that did not connect, keyed by
 * the `x` query parameter the callback sends back. Null for `connected`,
 * since the row then says so itself, and for a code it does not know.
 */
export function xConnectNotice(code: string | null | undefined): XConnectNotice | null {
  switch (code) {
    case 'denied':
      return { tone: 'problem', text: 'X was not connected: the sign-in on X was cancelled.' };
    case 'unconfigured':
      return { tone: 'problem', text: 'X was not connected: the X keys are not set yet.' };
    case 'state':
      return { tone: 'problem', text: 'X was not connected: the sign-in took too long or came from another tab. Try again.' };
    case 'exchange':
      return { tone: 'problem', text: 'X was not connected: X refused the sign-in. Try again, and check the callback address on the X app.' };
    case 'error':
      return { tone: 'problem', text: 'X was not connected: something went wrong saving the sign-in. Try again.' };
    default:
      return null;
  }
}
