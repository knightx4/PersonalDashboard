import { describe, expect, it } from 'vitest';
import { deliver } from '@/lib/news/inbound/deliver';
import type { NewsStore } from '@/lib/news/inbound/store';
import type { InboundMessage } from '@/lib/news/providers/types';

const DOMAIN = 'in.example.com';
const MINE = 'k7m2pq4xv9zd3b1n';
const ME = 'user-1';

function message(over: Partial<InboundMessage> = {}): InboundMessage {
  return {
    recipient: `${MINE}@${DOMAIN}`,
    senderEmail: 'hello@thepaper.com',
    senderName: 'The Paper',
    subject: 'This week',
    messageId: '<issue-42@thepaper.com>',
    textBody: 'Morning.',
    htmlBody: '<p>Morning.</p>',
    unsubscribeUrl: null,
    unsubscribeEmail: null,
    ...over,
  };
}

/** The three tables, in memory, with the unique index that matters. */
function fakeStore(addresses: Record<string, string> = { [MINE]: ME }) {
  const senders: { id: string; userId: string; email: string; name: string | null }[] = [];
  const issues: { userId: string; senderId: string; messageId: string }[] = [];

  const store: NewsStore = {
    async accountFor(localPart) {
      return addresses[localPart] ?? null;
    },
    async senderFor(userId, email, name) {
      const found = senders.find((row) => row.userId === userId && row.email === email);
      if (found) return found.id;
      const row = { id: `sender-${senders.length + 1}`, userId, email, name };
      senders.push(row);
      return row.id;
    },
    async storeIssue({ userId, senderId, message: incoming }) {
      const already = issues.some(
        (row) => row.userId === userId && row.messageId === incoming.messageId,
      );
      if (already) return 'repeat';
      issues.push({ userId, senderId, messageId: incoming.messageId });
      return 'stored';
    },
  };

  return { store, senders, issues };
}

describe('deliver', () => {
  it('stores one issue and its sender', async () => {
    const { store, senders, issues } = fakeStore();
    expect(await deliver(store, message(), DOMAIN)).toBe('stored');
    expect(issues).toHaveLength(1);
    expect(senders).toEqual([
      { id: 'sender-1', userId: ME, email: 'hello@thepaper.com', name: 'The Paper' },
    ]);
  });

  it('leaves one issue when the same message is delivered twice', async () => {
    const { store, senders, issues } = fakeStore();
    expect(await deliver(store, message(), DOMAIN)).toBe('stored');
    expect(await deliver(store, message(), DOMAIN)).toBe('repeat');
    expect(issues).toHaveLength(1);
    expect(senders).toHaveLength(1);
  });

  it('files a second issue from the same sender under the sender it already has', async () => {
    const { store, senders, issues } = fakeStore();
    await deliver(store, message(), DOMAIN);
    await deliver(store, message({ messageId: '<issue-43@thepaper.com>' }), DOMAIN);
    expect(issues).toHaveLength(2);
    expect(senders).toHaveLength(1);
  });

  it('stores nothing at all for an address nobody owns', async () => {
    const { store, senders, issues } = fakeStore({});
    expect(await deliver(store, message(), DOMAIN)).toBe('unaddressed');
    expect(issues).toHaveLength(0);
    expect(senders).toHaveLength(0);
  });

  it('stores nothing for mail addressed to another domain', async () => {
    const { store, issues } = fakeStore();
    expect(await deliver(store, message({ recipient: `${MINE}@elsewhere.com` }), DOMAIN)).toBe(
      'unaddressed',
    );
    expect(issues).toHaveLength(0);
  });

  it('stops answering the old address once it has been replaced', async () => {
    const { store, issues } = fakeStore({ 'newaddress1234567': ME });
    expect(await deliver(store, message(), DOMAIN)).toBe('unaddressed');
    expect(issues).toHaveLength(0);
  });
});
