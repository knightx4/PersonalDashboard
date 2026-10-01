import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GmailMessageMetadata } from '@/lib/email/providers/types';

/** Gmail as two mailboxes see it: message ids by access token, and each message's headers. */
const listed = new Map<string, string[]>();
const metadata = new Map<string, GmailMessageMetadata>();
const listMessages = vi.fn(async (token: string, opts: { query: string; maxResults?: number }) => {
  void opts;
  if (token === 'token-refused') throw new Error('Gmail API failed (401): invalid credentials');
  return { messages: (listed.get(token) ?? []).map((id) => ({ id })), nextPageToken: null };
});
const refreshAccessToken = vi.fn(async (refresh: string) => {
  if (refresh === 'refresh-revoked') throw new Error('invalid_grant');
  return { accessToken: `token-for-${refresh}`, refreshToken: refresh, expiresAt: new Date(Date.now() + 3600_000), idToken: null };
});

vi.mock('@/lib/email/providers/gmail', () => ({
  gmailProvider: {
    listMessages: (token: string, opts: { query: string }) => listMessages(token, opts),
    refreshAccessToken: (refresh: string) => refreshAccessToken(refresh),
  },
  getGmailMessageMetadata: async (_token: string, id: string) => metadata.get(id),
}));
vi.mock('@/lib/email/gmail-env', () => ({
  isGmailOAuthConfigured: () => true,
  gmailOAuthEnv: () => ({ TOKEN_ENCRYPTION_KEY: 'key' }),
}));
// Tokens are stored as-is in these fixtures.
vi.mock('@/lib/crypto/tokens', () => ({
  decryptToken: (value: string) => value,
  encryptToken: (value: string) => value,
}));

const { searchMail, mailSearchQuery } = await import('./search-mail');

type Account = { id: string; email_address: string; access: string | null; refresh: string };

function account(a: Account) {
  return {
    id: a.id,
    user_id: 'user-1',
    email_address: a.email_address,
    oauth_refresh_token: a.refresh,
    oauth_access_token: a.access,
    token_expires_at: a.access ? new Date(Date.now() + 3600_000).toISOString() : null,
    backfill_window_days: 365,
    sync_cursor: null,
    last_synced_at: null,
    status: 'active',
  };
}

/** The core client: the user's mailboxes, and whatever ensureAccessToken writes back. */
function fakeCore(accounts: Account[]) {
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const client = {
    from(table: string) {
      expect(table).toBe('email_accounts');
      return {
        select: () => ({
          eq: async (_col: string, userId: string) => ({
            data: userId === 'user-1' ? accounts.map(account) : [],
            error: null,
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: (_c: string, id: string) => ({
            eq: async () => {
              updates.push({ id, patch });
              return { error: null };
            },
          }),
        }),
      };
    },
  };
  return { core: client as never, updates };
}

function message(id: string, from: string, iso: string, subject: string): GmailMessageMetadata {
  return {
    id,
    threadId: `t-${id}`,
    internalDate: new Date(iso),
    from,
    to: 'me@example.com',
    subject,
    snippet: `preview of ${subject}`,
  };
}

const ANTHONY = 'Anthony Reyes <anthony@example.com>';

beforeEach(() => {
  listed.clear();
  metadata.clear();
  listMessages.mockClear();
  refreshAccessToken.mockClear();
});

describe('mailSearchQuery', () => {
  it('builds from, words and a date range into Gmail operators', () => {
    expect(
      mailSearchQuery({
        from: 'anthony@example.com',
        words: 'start date',
        after: '2026-09-01',
        before: '2026-10-01',
      }),
    ).toBe(`from:anthony@example.com start date after:${Date.UTC(2026, 8, 1) / 1000} before:${Date.UTC(2026, 9, 1) / 1000}`);
  });

  it('quotes a sender with a space and keeps operators out of the words', () => {
    expect(mailSearchQuery({ from: 'Anthony Reyes', words: 'flat OR in:trash -deposit "x"' })).toBe(
      'from:"Anthony Reyes" flat or in trash deposit x',
    );
  });

  it('ignores a date it cannot read', () => {
    expect(mailSearchQuery({ from: 'a@b.com', after: 'not a date' })).toBe('from:a@b.com');
  });
});

describe('searchMail', () => {
  it("returns a sender's messages newest first across every mailbox, each with a Gmail link", async () => {
    listed.set('token-personal', ['p1', 'p2']);
    listed.set('token-work', ['w1']);
    metadata.set('p1', message('p1', ANTHONY, '2026-09-20T09:00:00Z', 'Dinner'));
    metadata.set('p2', message('p2', ANTHONY, '2026-09-02T09:00:00Z', 'Flat'));
    metadata.set('w1', message('w1', ANTHONY, '2026-09-25T09:00:00Z', 'Start date'));

    const { core } = fakeCore([
      { id: 'acc-personal', email_address: 'me@example.com', access: 'token-personal', refresh: 'r1' },
      { id: 'acc-work', email_address: 'me@work.example', access: 'token-work', refresh: 'r2' },
    ]);

    const result = await searchMail(core, 'user-1', {
      from: 'anthony@example.com',
      after: '2026-09-01',
      before: '2026-10-01',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const query = `from:anthony@example.com after:${Date.UTC(2026, 8, 1) / 1000} before:${Date.UTC(2026, 9, 1) / 1000}`;
    expect(result.query).toBe(query);
    expect(listMessages).toHaveBeenCalledWith('token-personal', { query, maxResults: 20 });
    expect(listMessages).toHaveBeenCalledWith('token-work', { query, maxResults: 20 });

    expect(result.messages.map((m) => m.messageId)).toEqual(['w1', 'p1', 'p2']);
    expect(result.messages[0]).toMatchObject({
      accountId: 'acc-work',
      mailbox: 'me@work.example',
      from: ANTHONY,
      subject: 'Start date',
      date: '2026-09-25T09:00:00.000Z',
      snippet: 'preview of Start date',
      gmailUrl: 'https://mail.google.com/mail/?authuser=me%40work.example#all/w1',
    });
    expect(result.messages[1].gmailUrl).toBe(
      'https://mail.google.com/mail/?authuser=me%40example.com#all/p1',
    );
    expect(result.searched).toEqual(['me@example.com', 'me@work.example']);
    expect(result.problems).toEqual([]);
  });

  it('reports a revoked mailbox as a reason and still searches the others', async () => {
    listed.set('token-personal', ['p1']);
    metadata.set('p1', message('p1', ANTHONY, '2026-09-20T09:00:00Z', 'Dinner'));
    const { core, updates } = fakeCore([
      { id: 'acc-personal', email_address: 'me@example.com', access: 'token-personal', refresh: 'r1' },
      { id: 'acc-old', email_address: 'old@example.com', access: null, refresh: 'refresh-revoked' },
    ]);

    const result = await searchMail(core, 'user-1', { from: 'anthony@example.com' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.messages.map((m) => m.messageId)).toEqual(['p1']);
    expect(result.searched).toEqual(['me@example.com']);
    expect(result.problems).toEqual([
      {
        accountId: 'acc-old',
        mailbox: 'old@example.com',
        kind: 'needs_reauth',
        reason: expect.stringContaining('reconnect it in Settings'),
      },
    ]);
    // The refusal is recorded on the mailbox, as the sync records it.
    expect(updates).toContainEqual({ id: 'acc-old', patch: { status: 'needs_reauth' } });
  });

  it('reports a mailbox whose token Gmail refuses as needing to reconnect', async () => {
    const { core } = fakeCore([
      { id: 'acc-1', email_address: 'me@example.com', access: 'token-refused', refresh: 'r1' },
    ]);

    const result = await searchMail(core, 'user-1', { from: 'anthony@example.com' });

    expect(result).toMatchObject({
      ok: true,
      messages: [],
      searched: [],
      problems: [{ accountId: 'acc-1', kind: 'needs_reauth' }],
    });
  });

  it('says no mailbox is connected without calling Gmail', async () => {
    const { core } = fakeCore([]);

    const result = await searchMail(core, 'user-1', { from: 'anthony@example.com' });

    expect(result).toEqual({
      ok: false,
      kind: 'no_mailbox',
      reason: expect.stringContaining('No Gmail mailbox is connected'),
    });
    expect(listMessages).not.toHaveBeenCalled();
  });

  it('caps the results at twenty across mailboxes and says there are more', async () => {
    const ids = Array.from({ length: 15 }, (_, i) => i);
    listed.set('token-a', ids.map((i) => `a${i}`));
    listed.set('token-b', ids.map((i) => `b${i}`));
    for (const i of ids) {
      const day = String(i + 1).padStart(2, '0');
      metadata.set(`a${i}`, message(`a${i}`, ANTHONY, `2026-09-${day}T08:00:00Z`, `A${i}`));
      metadata.set(`b${i}`, message(`b${i}`, ANTHONY, `2026-09-${day}T09:00:00Z`, `B${i}`));
    }
    const { core } = fakeCore([
      { id: 'acc-a', email_address: 'a@example.com', access: 'token-a', refresh: 'ra' },
      { id: 'acc-b', email_address: 'b@example.com', access: 'token-b', refresh: 'rb' },
    ]);

    const result = await searchMail(core, 'user-1', { from: 'anthony@example.com' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.messages).toHaveLength(20);
    expect(result.messages[0].messageId).toBe('b14');
    expect(result.messages[1].messageId).toBe('a14');
    expect(result.more).toBe(true);
  });
});
