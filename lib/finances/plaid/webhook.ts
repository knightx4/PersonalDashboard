import { createHash, createPublicKey, timingSafeEqual, verify } from 'crypto';

/**
 * Checking a Plaid webhook (plan #2593.3).
 *
 * Plaid signs every webhook with a JWT in the Plaid-Verification header:
 * ES256, its key named by `kid` and fetched from
 * /webhook_verification_key/get, with the body's SHA-256 in the claim
 * `request_body_sha256` and the time it was sent in `iat`. A webhook is
 * accepted only when the signature holds, it is under five minutes old, and
 * the hash matches the body as received.
 */

export type VerificationKey = {
  alg: string;
  crv: string;
  kid: string;
  kty: string;
  x: string;
  y: string;
  expired_at: number | null;
};

/** How old a webhook may be, in seconds, before it is refused as a replay. */
export const MAX_AGE_SECONDS = 5 * 60;

export type Verified = { ok: true } | { ok: false; reason: string };

function base64url(part: string): Buffer {
  return Buffer.from(part, 'base64url');
}

function json(part: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(base64url(part).toString('utf8'));
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The `kid` a token names, read before its key is fetched. */
export function tokenKeyId(token: string | null | undefined): string | null {
  if (!token) return null;
  const header = json(token.split('.')[0] ?? '');
  if (!header || header.alg !== 'ES256' || typeof header.kid !== 'string') return null;
  return header.kid;
}

export function verifyPlaidWebhook(input: {
  token: string | null | undefined;
  body: string;
  key: VerificationKey | null;
  now?: Date;
}): Verified {
  const { token, body, key } = input;
  if (!token) return { ok: false, reason: 'no Plaid-Verification header' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed token' };
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

  const header = json(headerPart);
  if (!header || header.alg !== 'ES256') return { ok: false, reason: 'not ES256' };
  if (!key || key.kid !== header.kid) return { ok: false, reason: 'unknown key' };
  if (key.expired_at != null) return { ok: false, reason: 'expired key' };

  let signed: boolean;
  try {
    const publicKey = createPublicKey({
      key: { kty: key.kty, crv: key.crv, x: key.x, y: key.y },
      format: 'jwk',
    });
    signed = verify(
      'sha256',
      Buffer.from(`${headerPart}.${payloadPart}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      base64url(signaturePart),
    );
  } catch {
    signed = false;
  }
  if (!signed) return { ok: false, reason: 'bad signature' };

  const payload = json(payloadPart);
  const iat = typeof payload?.iat === 'number' ? payload.iat : null;
  const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (iat == null || now - iat > MAX_AGE_SECONDS) return { ok: false, reason: 'too old' };

  const claimed = typeof payload?.request_body_sha256 === 'string' ? payload.request_body_sha256 : '';
  const actual = createHash('sha256').update(body, 'utf8').digest('hex');
  const a = Buffer.from(claimed);
  const b = Buffer.from(actual);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'body does not match' };

  return { ok: true };
}

export type PlaidWebhook = {
  webhook_type: string;
  webhook_code: string;
  item_id: string;
  error?: { error_code?: string; error_message?: string; display_message?: string | null } | null;
};

/** The fields a recorded webhook needs, or null for a body that is not one. */
export function parseWebhook(body: string): PlaidWebhook | null {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  const v = value as Partial<PlaidWebhook>;
  if (typeof v?.webhook_type !== 'string' || typeof v.webhook_code !== 'string' || typeof v.item_id !== 'string') {
    return null;
  }
  return v as PlaidWebhook;
}

/**
 * Whether a webhook starts its link's sync at once (plan #2593.4): new or
 * changed transactions, new holdings or liabilities, or a login repaired so
 * the sync can run again. Everything else waits for the morning run.
 */
export function startsSync(hook: Pick<PlaidWebhook, 'webhook_type' | 'webhook_code'>): boolean {
  switch (hook.webhook_type) {
    case 'TRANSACTIONS':
      return hook.webhook_code === 'SYNC_UPDATES_AVAILABLE';
    case 'HOLDINGS':
    case 'LIABILITIES':
      return hook.webhook_code === 'DEFAULT_UPDATE';
    case 'ITEM':
      return hook.webhook_code === 'LOGIN_REPAIRED';
    default:
      return false;
  }
}

/**
 * What a webhook changes on its link at once, before the sync reads it.
 * A login Plaid says must be repeated marks the link needing attention, which
 * puts Fix sign-in on its row; LOGIN_REPAIRED clears it.
 */
export function linkPatchFor(
  hook: PlaidWebhook,
): { needs_update: boolean; status?: 'active' | 'error'; last_error: string | null } | null {
  if (hook.webhook_type !== 'ITEM') return null;
  const code = hook.error?.error_code ?? null;
  if (
    hook.webhook_code === 'PENDING_EXPIRATION' ||
    hook.webhook_code === 'PENDING_DISCONNECT' ||
    (hook.webhook_code === 'ERROR' && code === 'ITEM_LOGIN_REQUIRED')
  ) {
    return {
      needs_update: true,
      status: hook.webhook_code === 'ERROR' ? 'error' : undefined,
      last_error: hook.error?.display_message ?? hook.error?.error_message ?? code ?? hook.webhook_code,
    };
  }
  if (hook.webhook_code === 'LOGIN_REPAIRED') return { needs_update: false, status: 'active', last_error: null };
  return null;
}
