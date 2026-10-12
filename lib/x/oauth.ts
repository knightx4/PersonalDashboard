import { createHash, randomBytes } from 'crypto';

/**
 * X's OAuth 2.0 with PKCE, for reading the person's own posts (plan #1818,
 * feature #1815).
 *
 * The dashboard is a confidential client: the token endpoint is called with
 * the client id and secret as Basic auth, and the code verifier proves the
 * same browser started the round trip. Scopes are the three reading needs:
 * `tweet.read` and `users.read` for the posts and who wrote them, and
 * `offline.access` for a refresh token, without which the connection would
 * lapse after two hours.
 *
 * X rotates refresh tokens: every refresh returns a new one and the old one
 * stops working. Whoever refreshes must store the new pair before anything
 * else uses the account, which is why `freshXAccessToken` in ./account.ts is
 * the only caller of `refreshXTokens`.
 *
 * `fetch` is passed in so the tests can answer for X.
 */

export const X_AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';
export const X_TOKEN_URL = 'https://api.x.com/2/oauth2/token';
export const X_REVOKE_URL = 'https://api.x.com/2/oauth2/revoke';
export const X_ME_URL = 'https://api.x.com/2/users/me';
export const X_SCOPES = ['tweet.read', 'users.read', 'offline.access'] as const;

export type XClient = { clientId: string; clientSecret: string };

export type XTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scope: string | null;
};

export type XMe = { id: string; username: string; name: string };

type Fetch = typeof fetch;

/** A PKCE verifier: 43 characters of base64url, inside X's 43 to 128. */
export function createCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/** The S256 challenge X is sent for a verifier. */
export function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function xAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  verifier: string;
}): string {
  const url = new URL(X_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', X_SCOPES.join(' '));
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', codeChallenge(input.verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/** Thrown when X refuses a token request; `code` is X's `error` field. */
export class XOAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'XOAuthError';
  }
}

function basicAuth(client: XClient): string {
  return `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString('base64')}`;
}

async function tokenRequest(
  client: XClient,
  body: Record<string, string>,
  fetchImpl: Fetch,
  now: number,
): Promise<XTokens> {
  const res = await fetchImpl(X_TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: basicAuth(client),
    },
    body: new URLSearchParams({ ...body, client_id: client.clientId }).toString(),
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !json || typeof json.access_token !== 'string') {
    const code = typeof json?.error === 'string' ? json.error : null;
    const detail = typeof json?.error_description === 'string' ? json.error_description : null;
    throw new XOAuthError(
      `X token request failed (${res.status})${code ? `: ${code}` : ''}${detail ? ` - ${detail}` : ''}`,
      res.status,
      code,
    );
  }
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : null;
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : null,
    expiresAt: expiresIn ? new Date(now + expiresIn * 1000) : null,
    scope: typeof json.scope === 'string' ? json.scope : null,
  };
}

export function exchangeXCode(
  client: XClient,
  input: { code: string; redirectUri: string; verifier: string },
  fetchImpl: Fetch = fetch,
  now: number = Date.now(),
): Promise<XTokens> {
  return tokenRequest(
    client,
    {
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.verifier,
    },
    fetchImpl,
    now,
  );
}

export function refreshXTokens(
  client: XClient,
  refreshToken: string,
  fetchImpl: Fetch = fetch,
  now: number = Date.now(),
): Promise<XTokens> {
  return tokenRequest(client, { grant_type: 'refresh_token', refresh_token: refreshToken }, fetchImpl, now);
}

/** Who the token reads as. */
export async function fetchXMe(accessToken: string, fetchImpl: Fetch = fetch): Promise<XMe> {
  const res = await fetchImpl(X_ME_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => null)) as { data?: Partial<XMe> } | null;
  const data = json?.data;
  if (!res.ok || !data?.id || !data.username) {
    throw new Error(`X profile request failed (${res.status})`);
  }
  return { id: data.id, username: data.username, name: data.name ?? data.username };
}

/**
 * Tell X to forget a token. Best effort: Disconnect removes the row whether
 * or not X answers, since a token nobody holds any more reads nothing.
 */
export async function revokeXToken(
  client: XClient,
  token: string,
  hint: 'access_token' | 'refresh_token',
  fetchImpl: Fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchImpl(X_REVOKE_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: basicAuth(client),
      },
      body: new URLSearchParams({ token, token_type_hint: hint, client_id: client.clientId }).toString(),
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    return false;
  }
}
