import { createHash, randomBytes } from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import { decryptToken, encryptToken } from '@/lib/crypto/tokens';
import { signOAuthState, verifyOAuthState } from '@/lib/email/oauth-state';
import {
  freshXAccessToken,
  XDisconnectedError,
  xConnectionView,
  xConnectNotice,
  type XAccountRow,
} from './account';
import { isXOAuthConfigured } from './env';
import {
  codeChallenge,
  createCodeVerifier,
  exchangeXCode,
  fetchXMe,
  X_TOKEN_URL,
  xAuthorizationUrl,
  XOAuthError,
} from './oauth';
import { xPostsReturn } from './routes';

/** Connect an X account from the Posts tab (plan #1818). */

const KEY = randomBytes(32).toString('base64');
const CLIENT = { clientId: 'cid', clientSecret: 'secret' };
const NOW = Date.parse('2026-10-12T12:00:00Z');

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A Supabase stand-in that records every update made to x_accounts. */
function fakeDb() {
  const updates: Record<string, unknown>[] = [];
  const db = {
    from: (table: string) => {
      expect(table).toBe('x_accounts');
      return {
        update: (values: Record<string, unknown>) => {
          updates.push(values);
          const chain = { eq: () => chain, then: (ok: (v: { error: null }) => void) => ok({ error: null }) };
          return chain;
        },
      };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: db as any, updates };
}

function account(over: Partial<XAccountRow> = {}): XAccountRow {
  return {
    id: 'a1',
    user_id: 'u1',
    x_user_id: '42',
    handle: 'selvey',
    access_token: encryptToken('old-access', KEY),
    refresh_token: encryptToken('old-refresh', KEY),
    token_expires_at: new Date(NOW + 60 * 60 * 1000).toISOString(),
    status: 'active',
    last_synced_at: null,
    newest_post_id: null,
    created_at: '2026-10-12T00:00:00Z',
    ...over,
  };
}

describe('the authorize link', () => {
  it('asks for the three reading scopes with an S256 challenge of the verifier', () => {
    const verifier = createCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    const url = new URL(
      xAuthorizationUrl({ clientId: 'cid', redirectUri: 'https://dash.example/api/x/callback', state: 's', verifier }),
    );
    expect(url.origin + url.pathname).toBe('https://x.com/i/oauth2/authorize');
    expect(url.searchParams.get('scope')).toBe('tweet.read users.read offline.access');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(verifier).digest('base64url'),
    );
    expect(codeChallenge(verifier)).toBe(url.searchParams.get('code_challenge'));
    expect(url.searchParams.get('redirect_uri')).toBe('https://dash.example/api/x/callback');
  });
});

describe('the code exchange', () => {
  it('sends the verifier with Basic auth and reads the tokens and their expiry', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(String(_url)).toBe(X_TOKEN_URL);
      expect((init?.headers as Record<string, string>).authorization).toBe(
        `Basic ${Buffer.from('cid:secret').toString('base64')}`,
      );
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('code_verifier')).toBe('v');
      return json(200, { access_token: 'at', refresh_token: 'rt', expires_in: 7200, scope: 'tweet.read' });
    });
    const tokens = await exchangeXCode(CLIENT, { code: 'c', redirectUri: 'r', verifier: 'v' }, fetchImpl, NOW);
    expect(tokens).toEqual({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: new Date(NOW + 7_200_000),
      scope: 'tweet.read',
    });
  });

  it('throws XOAuthError with X’s error when refused', async () => {
    const fetchImpl = async () => json(400, { error: 'invalid_request', error_description: 'bad' });
    await expect(exchangeXCode(CLIENT, { code: 'c', redirectUri: 'r', verifier: 'v' }, fetchImpl)).rejects.toMatchObject({
      name: 'XOAuthError',
      status: 400,
      code: 'invalid_request',
    });
  });

  it('reads who the token is', async () => {
    const me = await fetchXMe('at', async () => json(200, { data: { id: '42', username: 'selvey', name: 'S' } }));
    expect(me).toEqual({ id: '42', username: 'selvey', name: 'S' });
  });
});

describe('freshXAccessToken', () => {
  it('hands back the stored token while more than five minutes are left', async () => {
    const { db, updates } = fakeDb();
    const fetchImpl = vi.fn();
    const token = await freshXAccessToken(db, account(), { client: CLIENT, encryptionKey: KEY, fetchImpl, now: NOW });
    expect(token).toBe('old-access');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it('refreshes near expiry and stores the rotated pair, encrypted', async () => {
    const { db, updates } = fakeDb();
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe('old-refresh');
      return json(200, { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 7200 });
    });
    const soon = account({ token_expires_at: new Date(NOW + 60_000).toISOString() });
    const token = await freshXAccessToken(db, soon, { client: CLIENT, encryptionKey: KEY, fetchImpl, now: NOW });
    expect(token).toBe('new-access');
    expect(updates).toHaveLength(1);
    expect(decryptToken(updates[0].access_token as string, KEY)).toBe('new-access');
    expect(decryptToken(updates[0].refresh_token as string, KEY)).toBe('new-refresh');
    expect(updates[0].status).toBe('active');
  });

  it('marks the account disconnected when X refuses the refresh', async () => {
    const { db, updates } = fakeDb();
    const fetchImpl = async () => json(400, { error: 'invalid_request' });
    const expired = account({ token_expires_at: new Date(NOW - 1000).toISOString() });
    await expect(
      freshXAccessToken(db, expired, { client: CLIENT, encryptionKey: KEY, fetchImpl, now: NOW }),
    ).rejects.toBeInstanceOf(XDisconnectedError);
    expect(updates).toEqual([
      { status: 'disconnected', access_token: null, refresh_token: null, token_expires_at: null },
    ]);
  });

  it('leaves the account active when X is down', async () => {
    const { db, updates } = fakeDb();
    const fetchImpl = async () => json(503, { error: 'unavailable' });
    const expired = account({ token_expires_at: new Date(NOW - 1000).toISOString() });
    await expect(
      freshXAccessToken(db, expired, { client: CLIENT, encryptionKey: KEY, fetchImpl, now: NOW }),
    ).rejects.toBeInstanceOf(XOAuthError);
    expect(updates).toEqual([]);
  });

  it('refuses a disconnected account without calling X', async () => {
    const { db } = fakeDb();
    const fetchImpl = vi.fn();
    await expect(
      freshXAccessToken(db, account({ status: 'disconnected' }), { client: CLIENT, encryptionKey: KEY, fetchImpl }),
    ).rejects.toBeInstanceOf(XDisconnectedError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('what the tab shows', () => {
  it('says the keys are missing before anything else', () => {
    expect(xConnectionView({ handle: 'selvey', status: 'active', last_synced_at: null }, false, 1816)).toEqual({
      state: 'unconfigured',
      setupStep: 1816,
    });
    expect(xConnectionView(null, true, 1816)).toEqual({ state: 'none' });
    expect(xConnectionView({ handle: 'selvey', status: 'disconnected', last_synced_at: null }, true, 1816)).toEqual({
      state: 'disconnected',
      handle: 'selvey',
    });
    expect(xConnectionView({ handle: 'selvey', status: 'active', last_synced_at: null }, true, 1816)).toEqual({
      state: 'connected',
      handle: 'selvey',
      lastSyncedAt: null,
    });
  });

  it('needs both keys and the encryption key to offer Connect X', () => {
    expect(isXOAuthConfigured({})).toBe(false);
    expect(isXOAuthConfigured({ X_CLIENT_ID: 'a', X_CLIENT_SECRET: 'b' })).toBe(false);
    expect(isXOAuthConfigured({ X_CLIENT_ID: 'a', X_CLIENT_SECRET: 'b', TOKEN_ENCRYPTION_KEY: 'k' })).toBe(true);
  });

  it('turns each failed round trip into a line, and says nothing on success or an unknown code', () => {
    for (const code of ['denied', 'unconfigured', 'state', 'exchange', 'error']) {
      expect(xConnectNotice(code)?.tone).toBe('problem');
    }
    expect(xConnectNotice('connected')).toBeNull();
    expect(xConnectNotice('nonsense')).toBeNull();
    expect(xConnectNotice(null)).toBeNull();
    expect(xPostsReturn('https://dash.example/api/x/callback?code=1', 'denied').toString()).toBe(
      'https://dash.example/dev/posts?x=denied',
    );
  });

  it('signs state for one user', () => {
    const state = signOAuthState('u1', KEY);
    expect(verifyOAuthState(state, 'u1', KEY)).toBe(true);
    expect(verifyOAuthState(state, 'u2', KEY)).toBe(false);
  });
});
