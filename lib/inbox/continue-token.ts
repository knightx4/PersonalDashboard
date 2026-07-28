import { createHmac, timingSafeEqual } from 'node:crypto';

export function signInboxContinueToken(
  secret: string,
  payload: { userId: string; accountId: string; jobId: string },
): string {
  const body = `${payload.userId}:${payload.accountId}:${payload.jobId}`;
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function verifyInboxContinueToken(
  secret: string,
  payload: { userId: string; accountId: string; jobId: string },
  token: string,
): boolean {
  const expected = signInboxContinueToken(secret, payload);
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  } catch {
    return false;
  }
}
