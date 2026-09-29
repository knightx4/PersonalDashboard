/**
 * Re-reading receipts filed under the store's name (plan #1212): the heuristic
 * no longer files an Apple receipt under "Apple", and the one-off pass moves
 * each charge filed there to the service its message names, or notes why not.
 */
import { describe, expect, it, vi } from 'vitest';
import type { RecurringReading } from './extract';
import { heuristicRecurring, namesTheStore } from './extraction';
import { memoryClient, type Row } from './memory-client';
import { rereadStoreReceipts, type RereadMessage } from './reread';

const USER = 'user-1';
const APPLE_FROM = 'Apple <no_reply@email.apple.com>';

describe('the heuristic on a store receipt', () => {
  const receipt = {
    subject: 'Your receipt from Apple.',
    text: 'Apple Account\nYouTube Premium\nMonthly\n$22.72\nTotal $22.72',
    fromAddress: APPLE_FROM,
    receivedOn: '2026-09-21',
    hint: 'subscription' as const,
  };

  it('does not file an Apple receipt under "Apple"', () => {
    expect(heuristicRecurring(receipt)).toBeNull();
  });

  it('still reads a service that sends its own receipts', () => {
    const reading = heuristicRecurring({
      ...receipt,
      subject: 'Your receipt from Notion',
      fromAddress: 'Notion <billing@notion.so>',
    });
    expect(reading).toMatchObject({ payee: 'Notion', amountCents: 2272 });
  });

  it('tells the store apart from what it sells', () => {
    expect(namesTheStore('Apple', APPLE_FROM)).toBe(true);
    expect(namesTheStore('Google Play', 'Google Play <googleplay-noreply@google.com>')).toBe(true);
    expect(namesTheStore('Apple TV', APPLE_FROM)).toBe(false);
    expect(namesTheStore('iCloud+', APPLE_FROM)).toBe(false);
    // "Apple" from somebody else's domain is not a store receipt.
    expect(namesTheStore('Apple', 'Orchard <hi@apple-farm.example>')).toBe(false);
  });
});

function tables(): Record<string, Row[]> {
  const charge = (id: string, day: string, cents: number): Row => ({
    id,
    user_id: USER,
    payment_id: 'apple',
    message_id: `m-${id}`,
    event: 'charge',
    amount_cents: cents,
    previous_amount_cents: null,
    currency: 'USD',
    period: null,
    occurred_on: day,
    due_on: null,
    created_at: `${day}T09:00:00Z`,
  });
  return {
    recurring_payments: [
      {
        id: 'apple',
        user_id: USER,
        payee: 'Apple',
        payee_key: 'apple',
        kind: 'subscription',
        sender_domain: 'email.apple.com',
        status: 'active',
        currency: 'USD',
      },
      {
        id: 'yt',
        user_id: USER,
        payee: 'YouTube Premium',
        payee_key: 'youtubepremium',
        kind: 'subscription',
        sender_domain: 'email.apple.com',
        status: 'active',
        currency: 'USD',
      },
    ],
    recurring_payee_aliases: [],
    recurring_charges: [
      charge('a', '2026-04-13', 1899),
      charge('b', '2026-03-12', 399),
      charge('c', '2026-06-19', 2099),
    ],
    recurring_messages: [
      { id: 'm-a', user_id: USER, parse_status: 'parsed', error: null },
      { id: 'm-b', user_id: USER, parse_status: 'parsed', error: null },
      { id: 'm-c', user_id: USER, parse_status: 'parsed', error: null },
    ],
  };
}

/** What each Gmail id's body names, as the model would read it. */
const BODIES: Record<string, string> = {
  'g-a': 'YouTube Premium',
  'g-b': 'Slopes: Ski & Snowboard',
  'g-c': 'Apple',
};

const reader = vi.fn(
  async (input: { text: string; receivedOn: string }): Promise<RecurringReading> => ({
    ok: true,
    source: 'llm',
    value: {
      payee: input.text,
      kind: 'subscription',
      event: 'charge',
      amountCents: 100,
      previousAmountCents: null,
      currency: 'USD',
      period: 'month',
      occurredOn: input.receivedOn,
      dueOn: null,
    },
  }),
);

function run(t: Record<string, Row[]>, fetchMessage?: (id: string) => Promise<RereadMessage>) {
  return rereadStoreReceipts(memoryClient(t), {
    userId: USER,
    providerIds: async (ids) => new Map(ids.map((id) => [id, id.replace(/^m-/, 'g-')])),
    fetchMessage:
      fetchMessage ??
      (async (id) => ({
        subject: 'Your receipt from Apple.',
        text: BODIES[id]!,
        fromAddress: APPLE_FROM,
      })),
    read: reader,
  });
}

describe('rereadStoreReceipts', () => {
  it('moves each charge to the service its message names and notes the one it cannot', async () => {
    const t = tables();
    const result = await run(t);

    expect(result.moved.map((m) => [m.chargeId, m.movedTo])).toEqual([
      ['a', 'YouTube Premium'],
      ['b', 'Slopes: Ski & Snowboard'],
    ]);
    expect(result.unreadable).toEqual([
      expect.objectContaining({ chargeId: 'c', unreadable: 'no service named' }),
    ]);

    const on = (id: string) => t.recurring_charges.find((c) => c.id === id)!.payment_id;
    // Onto the existing row, onto a new one, and left where it was.
    expect(on('a')).toBe('yt');
    const slopes = t.recurring_payments.find((p) => p.payee_key === 'slopesskisnowboard');
    expect(on('b')).toBe(slopes?.id);
    expect(on('c')).toBe('apple');
    // The amount is the one first read, not the re-reading's.
    expect(t.recurring_charges.find((c) => c.id === 'a')!.amount_cents).toBe(1899);
    expect(t.recurring_messages.find((m) => m.id === 'm-c')!.error).toBe(
      'reread: no service named',
    );
  });

  it('does not fetch a message it has already failed to re-read', async () => {
    const t = tables();
    await run(t);
    const fetchMessage = vi.fn(async () => ({ subject: '', text: '', fromAddress: APPLE_FROM }));
    const again = await run(t, fetchMessage);
    expect(fetchMessage).not.toHaveBeenCalled();
    expect(again).toEqual({ moved: [], unreadable: [] });
  });

  it('removes the store row once every charge is moved off it', async () => {
    const t = tables();
    t.recurring_charges = t.recurring_charges.filter((c) => c.id !== 'c');
    await run(t);
    expect(t.recurring_payments.find((p) => p.id === 'apple')).toBeUndefined();
  });

  it('says a message is gone when Gmail no longer has it', async () => {
    const t = tables();
    const result = await run(t, async () => {
      throw new Error('Gmail API failed (404): Requested entity was not found.');
    });
    expect(result.unreadable.map((u) => u.unreadable)).toEqual([
      'no longer in the mailbox',
      'no longer in the mailbox',
      'no longer in the mailbox',
    ]);
  });
});
