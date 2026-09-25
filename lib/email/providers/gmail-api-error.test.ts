import { describe, expect, it } from 'vitest';
import { formatGmailApiError, gmailRetryDelayMs, isGmailRateLimit } from './gmail-api-error';

describe('formatGmailApiError', () => {
  it('explains a disabled Gmail API', () => {
    const msg = formatGmailApiError(
      403,
      JSON.stringify({
        error: {
          message:
            'Gmail API has not been used in project 123 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=123',
        },
      }),
    );
    expect(msg).toMatch(/Gmail API is disabled/);
    expect(msg).toMatch(/gmail\.googleapis\.com/);
  });

  it('explains missing Gmail scopes', () => {
    const msg = formatGmailApiError(
      403,
      JSON.stringify({
        error: {
          message: 'Request had insufficient authentication scopes.',
          status: 'PERMISSION_DENIED',
          details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }],
        },
      }),
    );
    expect(msg).toMatch(/Gmail read access was not granted/i);
    expect(msg).toMatch(/See and download your email/i);
  });

  it('keeps a short generic failure otherwise', () => {
    expect(formatGmailApiError(500, 'boom')).toBe('Gmail API failed (500): boom');
  });
});

const PER_MINUTE = JSON.stringify({
  error: {
    code: 403,
    message:
      "Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user' of service 'gmail.googleapis.com' for consumer 'project_number:1'.",
    errors: [{ reason: 'rateLimitExceeded' }],
  },
});

describe('isGmailRateLimit', () => {
  it('treats the per-minute quota refusal as a rate limit', () => {
    expect(isGmailRateLimit(403, PER_MINUTE)).toBe(true);
    expect(isGmailRateLimit(429, '')).toBe(true);
  });

  it('leaves a daily limit and other refusals alone', () => {
    expect(isGmailRateLimit(403, 'Quota exceeded for quota metric per day')).toBe(false);
    expect(isGmailRateLimit(403, 'Request had insufficient authentication scopes.')).toBe(false);
    expect(isGmailRateLimit(500, PER_MINUTE)).toBe(false);
  });

  it('explains a rate limit that outlasted the retries', () => {
    expect(formatGmailApiError(403, PER_MINUTE)).toMatch(/Wait a minute, then Import again/);
  });
});

describe('gmailRetryDelayMs', () => {
  it('follows Retry-After when Gmail sends one', () => {
    expect(gmailRetryDelayMs(0, '7')).toBe(7000);
    expect(gmailRetryDelayMs(0, '600')).toBe(60_000);
  });

  it('doubles from two seconds otherwise, with jitter on top', () => {
    expect(gmailRetryDelayMs(0, null, () => 0)).toBe(2000);
    expect(gmailRetryDelayMs(3, null, () => 0)).toBe(16_000);
    expect(gmailRetryDelayMs(0, null, () => 1)).toBe(2500);
  });
});
