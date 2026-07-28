import { createHmac, timingSafeEqual } from 'crypto';

const MAX_AGE_MS = 15 * 60 * 1000;

function hmac(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Signed, time-limited state tying the OAuth round-trip to one user. */
export function signGmailOAuthState(userId: string, secret: string): string {
  const ts = Date.now();
  const payload = `${userId}.${ts}`;
  const sig = hmac(secret, payload);
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}

export function verifyGmailOAuthState(state: string, userId: string, secret: string): boolean {
  try {
    const decoded = Buffer.from(state, 'base64url').toString('utf8');
    const lastDot = decoded.lastIndexOf('.');
    if (lastDot === -1) return false;

    const payload = decoded.slice(0, lastDot);
    const sig = decoded.slice(lastDot + 1);
    const expected = hmac(secret, payload);
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expected);
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
      return false;
    }

    const [stateUserId, tsRaw] = payload.split('.');
    if (stateUserId !== userId) return false;

    const ts = Number(tsRaw);
    if (!Number.isFinite(ts) || Date.now() - ts > MAX_AGE_MS) return false;

    return true;
  } catch {
    return false;
  }
}
