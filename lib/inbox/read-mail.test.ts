import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GmailMessageText } from '@/lib/email/providers/types';

/** Gmail as one mailbox sees it: each message's headers and text by id. */
const messages = new Map<string, GmailMessageText>();
const getGmailMessageText = vi.fn(async (token: string, id: string) => {
  if (token === 'token-refused') throw new Error('Gmail API failed (401): invalid credentials');
  const message = messages.get(id);
  if (!message) throw new Error('Gmail API failed (404): Requested entity was not found.');
  return message;
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/email/providers/gmail', () => ({
  gmailProvider: { refreshAccessToken: async () => ({ accessToken: 'fresh', refreshToken: 'r', expiresAt: null, idToken: null }) },
  getGmailMessageText: (token: string, id: string) => getGmailMessageText(token, id),
}));
vi.mock('@/lib/email/gmail-env', () => ({
  isGmailOAuthConfigured: () => true,
  gmailOAuthEnv: () => ({ TOKEN_ENCRYPTION_KEY: 'key' }),
}));
vi.mock('@/lib/crypto/tokens', () => ({
  decryptToken: (value: string) => value,
  encryptToken: (value: string) => value,
}));

const { boundMailText, readMail, MAIL_TEXT_LIMIT } = await import('./read-mail');

/** The core client: one mailbox of user-1's, found by its id. */
function fakeCore(access: string) {
  const row = {
    id: 'acc-1',
    user_id: 'user-1',
    email_address: 'me@example.com',
    oauth_refresh_token: 'r',
    oauth_access_token: access,
    token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    backfill_window_days: 365,
    sync_cursor: null,
    last_synced_at: null,
    status: 'active',
  };
  const filters: Record<string, string> = {};
  const query = {
    select: () => query,
    eq: (column: string, value: string) => {
      filters[column] = value;
      return query;
    },
    maybeSingle: async () => ({
      data: filters.id === row.id && filters.user_id === row.user_id ? row : null,
      error: null,
    }),
  };
  return { from: () => query } as never;
}

beforeEach(() => {
  messages.clear();
  getGmailMessageText.mockClear();
});

describe('boundMailText', () => {
  it('tidies line endings and blank lines and leaves a short text whole', () => {
    expect(boundMailText('Hi,\r\n\r\n\r\n\r\nSee you Monday.  \r\n')).toEqual({
      text: 'Hi,\n\nSee you Monday.',
      truncated: false,
    });
  });

  it('cuts a long text at a space before the limit', () => {
    const { text, truncated } = boundMailText('word '.repeat(3000));
    expect(truncated).toBe(true);
    expect(text.length).toBeLessThanOrEqual(MAIL_TEXT_LIMIT);
    expect(text.endsWith('word')).toBe(true);
  });
});

describe('readMail', () => {
  it("returns the message's text, cut to the limit, with its Gmail link", async () => {
    messages.set('18f2a', {
      id: '18f2a',
      threadId: '18f2a',
      internalDate: new Date('2026-09-28T13:05:00Z'),
      from: 'Priya Shah <priya@recruit.example>',
      to: 'me@example.com',
      subject: 'Your offer',
      text: 'x'.repeat(MAIL_TEXT_LIMIT + 500),
    });
    const result = await readMail(fakeCore('token-ok'), 'user-1', { accountId: 'acc-1', messageId: '18f2a' });
    if (!result.ok) throw new Error(result.reason);
    expect(getGmailMessageText).toHaveBeenCalledWith('token-ok', '18f2a');
    expect(result.message).toMatchObject({
      mailbox: 'me@example.com',
      subject: 'Your offer',
      date: '2026-09-28T13:05:00.000Z',
      truncated: true,
      gmailUrl: 'https://mail.google.com/mail/?authuser=me%40example.com#all/18f2a',
    });
    expect(result.message.text).toHaveLength(MAIL_TEXT_LIMIT);
  });

  it("does not reach a mailbox that is not the person's", async () => {
    const result = await readMail(fakeCore('token-ok'), 'user-2', { accountId: 'acc-1', messageId: '18f2a' });
    expect(result).toMatchObject({ ok: false, kind: 'not_found' });
    expect(getGmailMessageText).not.toHaveBeenCalled();
  });

  it('says a message is not there, and that a refused mailbox needs reconnecting', async () => {
    expect(await readMail(fakeCore('token-ok'), 'user-1', { accountId: 'acc-1', messageId: 'ffff' })).toMatchObject({
      ok: false,
      kind: 'not_found',
    });
    expect(await readMail(fakeCore('token-refused'), 'user-1', { accountId: 'acc-1', messageId: '18f2a' })).toMatchObject({
      ok: false,
      kind: 'needs_reauth',
      reason: expect.stringContaining('reconnect it in Settings'),
    });
  });
});
