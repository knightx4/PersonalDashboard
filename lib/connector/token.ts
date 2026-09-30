/**
 * Whether a bearer token may read through the connector (plan #1255).
 *
 * A token from Supabase's OAuth server is an ordinary access token for the
 * person, signed with the project's key, plus a `client_id` claim naming the
 * app it was issued to. getClaims() checks the signature and the expiry; the
 * rest is checked here: the issuer, the audience, the client_id that tells a
 * connector's token from a browser session's, and that the token was not
 * issued before the person last removed that app. Removing an app stops its
 * refresh token at once, but an access token already issued would otherwise
 * keep working for the rest of its hour.
 *
 * No client and no `server-only` here, so every refusal can be tested with
 * stubbed claims; lib/connector/access.ts wires in the real ones.
 */

/** What a verified connector token says about who is calling. */
export type ConnectorCaller = {
  userId: string;
  /** The OAuth client the token was issued to. */
  clientId: string;
  /** When the token was issued, in seconds since the epoch. */
  issuedAt: number;
};

/** Why a token was refused. Every one is a 401 to the client. */
export type ConnectorRefusalReason =
  | 'missing'
  | 'invalid'
  | 'expired'
  | 'wrong_issuer'
  | 'wrong_audience'
  | 'not_connector'
  | 'revoked';

export type ConnectorRefusal = { ok: false; reason: ConnectorRefusalReason; error: string };

export type ConnectorTokenVerdict = { ok: true; caller: ConnectorCaller } | ConnectorRefusal;

const MESSAGES: Record<ConnectorRefusalReason, string> = {
  missing: 'This address needs a bearer token from connecting the app.',
  invalid: 'The token could not be verified.',
  expired: 'The token has expired.',
  wrong_issuer: 'The token was not issued for this app.',
  wrong_audience: 'The token was not issued for this app.',
  not_connector: 'This address only accepts a token issued to a connected app, not a sign-in session.',
  revoked: 'This app was removed from the account after the token was issued. Connect it again.',
};

export function refusal(reason: ConnectorRefusalReason): ConnectorRefusal {
  return { ok: false, reason, error: MESSAGES[reason] };
}

/** The token in an `Authorization: Bearer …` header, or null. */
export function bearerToken(header: string | null | undefined): string | null {
  const match = /^\s*bearer\s+(\S+)\s*$/i.exec(header ?? '');
  return match ? match[1] : null;
}

/** The auth server's issuer for a project URL: `https://<ref>.supabase.co/auth/v1`. */
export function authIssuer(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`;
}

type Claims = Record<string, unknown>;

/**
 * Check claims whose signature is already verified. `revokedAt` is when the
 * person last removed this client (ISO), or null; it is asked for only once
 * the token has named a client, so it takes the client id.
 */
export async function checkConnectorClaims(
  claims: Claims,
  deps: {
    issuer: string;
    lastRevocation: (userId: string, clientId: string) => Promise<string | null>;
    /** Milliseconds since the epoch; Date.now() when absent. */
    now?: number;
  },
): Promise<ConnectorTokenVerdict> {
  const now = deps.now ?? Date.now();
  const { sub, exp, iat, iss, aud, client_id: clientId } = claims;

  if (typeof sub !== 'string' || sub === '') return refusal('invalid');
  if (typeof exp !== 'number' || exp * 1000 <= now) return refusal('expired');
  if (iss !== deps.issuer) return refusal('wrong_issuer');
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.includes('authenticated')) return refusal('wrong_audience');
  if (typeof clientId !== 'string' || clientId === '') return refusal('not_connector');
  // Without an issue time there is no telling it from a token issued before a revoke.
  if (typeof iat !== 'number') return refusal('invalid');

  const revokedAt = await deps.lastRevocation(sub, clientId);
  // iat is whole seconds, so a token from the same second as the revoke is
  // refused whichever came first: reconnecting takes longer than that.
  if (revokedAt && iat * 1000 < Date.parse(revokedAt) + 1000) return refusal('revoked');

  return { ok: true, caller: { userId: sub, clientId, issuedAt: iat } };
}

/**
 * Verify a bearer token end to end: the signature and expiry through
 * `getClaims`, then the claims above. Never throws for a bad token; a failure
 * reading the revocations does throw, so a token is never let through because
 * the check could not run.
 */
export async function verifyConnectorToken(
  token: string | null,
  deps: {
    getClaims: (token: string) => Promise<{ data: { claims: Claims } | null; error: unknown }>;
    issuer: string;
    lastRevocation: (userId: string, clientId: string) => Promise<string | null>;
    now?: number;
  },
): Promise<ConnectorTokenVerdict> {
  if (!token) return refusal('missing');
  let claims: Claims | null = null;
  let failure: unknown = null;
  try {
    const { data, error } = await deps.getClaims(token);
    claims = data?.claims ?? null;
    failure = error;
  } catch (error) {
    failure = error;
  }
  if (!claims) {
    const message = failure instanceof Error ? failure.message : '';
    return refusal(/expired/i.test(message) ? 'expired' : 'invalid');
  }
  return checkConnectorClaims(claims, deps);
}
