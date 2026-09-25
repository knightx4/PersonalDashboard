/** Map raw Gmail HTTP failures to short, actionable messages for the UI. */
export function formatGmailApiError(status: number, body: string): string {
  if (
    status === 403 &&
    /Gmail API has not been used|it is disabled|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient authentication scopes/i.test(
      body,
    )
  ) {
    if (/has not been used|it is disabled/i.test(body)) {
      return 'Gmail API is disabled on the Google Cloud project. Enable gmail.googleapis.com for the OAuth client project, wait a minute, then Import again.';
    }
    return 'Gmail read access was not granted. Disconnect, then Connect Gmail again and leave “See and download your email” checked on Google’s consent screen.';
  }
  if (isGmailRateLimit(status, body)) {
    return 'Gmail is limiting how fast this inbox can be read. Wait a minute, then Import again; messages already read are kept.';
  }
  return `Gmail API failed (${status}): ${body.replace(/\s+/g, ' ').slice(0, 180)}`;
}

/**
 * Whether Gmail refused the request for going too fast.
 *
 * Gmail reports its per-user rate limit either as a 429 or as a 403 whose
 * reason is rateLimitExceeded or "Quota exceeded … per minute". Both clear on
 * their own within the minute. A daily limit does not, so it is left out:
 * retrying it only burns the invocation's time.
 */
export function isGmailRateLimit(status: number, body: string): boolean {
  if (status === 429) return true;
  if (status !== 403) return false;
  if (/per day|dailyLimitExceeded/i.test(body)) return false;
  return /rateLimitExceeded|userRateLimitExceeded|RATE_LIMIT_EXCEEDED|Quota exceeded/i.test(body);
}

/** Retries after a rate-limit refusal before the request fails for real. */
export const GMAIL_RATE_LIMIT_RETRIES = 5;

/**
 * How long to wait before retry number `attempt` (0-based).
 *
 * Retry-After wins when Gmail sends one. Otherwise the wait doubles from two
 * seconds, with jitter so the six requests in flight do not all come back in
 * the same instant and trip the limit again. The five waits add up to about a
 * minute, which is the window the per-minute quota is counted over.
 */
export function gmailRetryDelayMs(
  attempt: number,
  retryAfter: string | null,
  random: () => number = Math.random,
): number {
  const seconds = retryAfter != null ? Number(retryAfter) : Number.NaN;
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds, 60) * 1000;
  }
  const base = 2000 * 2 ** attempt;
  return Math.round(base + base * 0.25 * random());
}
