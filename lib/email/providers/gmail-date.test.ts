/**
 * Gmail's internalDate of "0" was read as 1 January 1970, because "0" is a
 * truthy string. These cover the helper and the three readers that use it,
 * the readers driven through a stubbed fetch so the real parsing runs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gmailInternalDate } from '@/lib/email/providers/gmail-date';
import { getGmailMessageMetadata, getGmailMessageText, getGmailThread } from '@/lib/email/providers/gmail';

describe('gmailInternalDate', () => {
  it('reads epoch milliseconds', () => {
    expect(gmailInternalDate('1759485600000')?.toISOString()).toBe('2025-10-03T10:00:00.000Z');
  });

  it('reads "0" as no date rather than 1970', () => {
    expect(gmailInternalDate('0')).toBeNull();
  });

  it('reads missing, empty, negative and non-numeric values as no date', () => {
    for (const value of [undefined, null, '', '  ', '-5', 'abc', '12.5', 'NaN', '1e12']) {
      expect(gmailInternalDate(value)).toBeNull();
    }
  });

  it('reads a value too large for a Date as no date', () => {
    expect(gmailInternalDate('9'.repeat(30))).toBeNull();
  });
});

describe('the Gmail readers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function gmailAnswers(internalDate: string) {
    const message = {
      id: 'm1',
      threadId: 't1',
      internalDate,
      payload: { mimeType: 'text/plain', headers: [{ name: 'Subject', value: 'Hello' }], body: {} },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        new Response(JSON.stringify(url.includes('/threads/') ? { messages: [message] } : message), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
  }

  it('give a message dated "0" no date', async () => {
    gmailAnswers('0');
    expect((await getGmailMessageMetadata('token', 'm1')).internalDate).toBeNull();
    expect((await getGmailMessageText('token', 'm1')).internalDate).toBeNull();
    expect((await getGmailThread('token', 't1'))[0].internalDate).toBeNull();
  });

  it('keep a real date', async () => {
    gmailAnswers('1759485600000');
    expect((await getGmailMessageMetadata('token', 'm1')).internalDate?.toISOString()).toBe(
      '2025-10-03T10:00:00.000Z',
    );
  });
});
