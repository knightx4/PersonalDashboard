import { describe, expect, it } from 'vitest';
import { formatGmailApiError } from './gmail-api-error';

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

  it('keeps a short generic failure otherwise', () => {
    expect(formatGmailApiError(500, 'boom')).toBe('Gmail API failed (500): boom');
  });
});
