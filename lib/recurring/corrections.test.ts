import { describe, expect, it } from 'vitest';
import { billTitle } from '@/lib/todo/agenda/sources/bills';
import { mergePayments, renamePayment } from './corrections';
import { memoryClient, type Row } from './memory-client';
import { fileRecurringReading } from './store';

const USER = 'user-1';

function tablesWithUI(): Record<string, Row[]> {
  return {
    recurring_payments: [
      {
        id: 'ui',
        user_id: USER,
        payee: 'UI',
        payee_key: 'ui',
        kind: 'bill',
        status: 'active',
        amount_cents: 8400,
        currency: 'USD',
      },
    ],
    recurring_payee_aliases: [],
    recurring_charges: [],
  };
}

describe('renamePayment', () => {
  it('changes the name shown and keeps the key the mail wrote', async () => {
    const tables = tablesWithUI();
    const result = await renamePayment(memoryClient(tables), {
      userId: USER,
      paymentId: 'ui',
      payee: '  Eversource   Electric ',
    });
    expect(result).toEqual({});
    expect(tables.recurring_payments[0]).toMatchObject({
      payee: 'Eversource Electric',
      payee_key: 'ui',
    });
    expect(billTitle(tables.recurring_payments[0] as Parameters<typeof billTitle>[0])).toBe(
      'Eversource Electric bill due, $84.00',
    );
  });

  it('files a new bill under the old name on the renamed row', async () => {
    const tables = tablesWithUI();
    const client = memoryClient(tables);
    await renamePayment(client, { userId: USER, paymentId: 'ui', payee: 'Eversource' });

    const { paymentId } = await fileRecurringReading(client, {
      userId: USER,
      messageId: 'm-oct',
      senderDomain: 'ui.example',
      reading: {
        payee: 'UI',
        kind: 'bill',
        event: 'bill',
        amountCents: 9100,
        previousAmountCents: null,
        currency: 'USD',
        period: 'month',
        occurredOn: '2026-10-01',
        dueOn: '2026-10-20',
      },
    });

    expect(paymentId).toBe('ui');
    expect(tables.recurring_payments).toHaveLength(1);
    expect(tables.recurring_payments[0]).toMatchObject({ payee: 'Eversource' });
  });

  it('refuses an empty name', async () => {
    const tables = tablesWithUI();
    const result = await renamePayment(memoryClient(tables), {
      userId: USER,
      paymentId: 'ui',
      payee: '   ',
    });
    expect(result.error).toBeTruthy();
    expect(tables.recurring_payments[0]).toMatchObject({ payee: 'UI' });
  });

  it("does not rename another person's payment", async () => {
    const tables = tablesWithUI();
    const result = await renamePayment(memoryClient(tables), {
      userId: 'someone-else',
      paymentId: 'ui',
      payee: 'Mine now',
    });
    expect(result.error).toBeTruthy();
    expect(tables.recurring_payments[0]).toMatchObject({ payee: 'UI' });
  });
});

/**
 * Mail filed "YouTube Premium" for five months and plain "YouTube" for three
 * (March to July, then August to October): one subscription under two names.
 */
function tablesWithYouTube(): Record<string, Row[]> {
  const payment = (id: string, payee: string, key: string): Row => ({
    id,
    user_id: USER,
    payee,
    payee_key: key,
    kind: 'subscription',
    status: 'active',
    amount_cents: 1399,
    currency: 'USD',
    period: 'month',
  });
  const charge = (paymentId: string, month: string): Row => ({
    id: `c-${paymentId}-${month}`,
    user_id: USER,
    payment_id: paymentId,
    message_id: `m-${paymentId}-${month}`,
    event: 'charge',
    amount_cents: 1399,
    previous_amount_cents: null,
    currency: 'USD',
    period: 'month',
    occurred_on: `2026-${month}-14`,
    due_on: null,
    created_at: `2026-${month}-14T09:00:00Z`,
  });
  return {
    recurring_payments: [
      payment('premium', 'YouTube Premium', 'youtubepremium'),
      payment('plain', 'YouTube', 'youtube'),
    ],
    recurring_payee_aliases: [
      // An earlier rename had pointed "YT" at the plain row.
      { id: 'a-yt', user_id: USER, payee_key: 'yt', payment_id: 'plain' },
    ],
    recurring_charges: [
      ...['03', '04', '05', '06', '07'].map((m) => charge('premium', m)),
      ...['08', '09', '10'].map((m) => charge('plain', m)),
    ],
  };
}

const youtubeReading = (payee: string, month: string) => ({
  userId: USER,
  messageId: `m-new-${payee}-${month}`,
  senderDomain: 'youtube.com',
  reading: {
    payee,
    kind: 'subscription' as const,
    event: 'charge' as const,
    amountCents: 1399,
    previousAmountCents: null,
    currency: 'USD',
    period: 'month' as const,
    occurredOn: `2026-${month}-14`,
    dueOn: null,
  },
});

describe('mergePayments', () => {
  it('leaves one row with every charge of both and the next date from them all', async () => {
    const tables = tablesWithYouTube();
    const result = await mergePayments(memoryClient(tables), {
      userId: USER,
      paymentId: 'plain',
      intoId: 'premium',
    });

    expect(result).toEqual({});
    expect(tables.recurring_payments).toHaveLength(1);
    expect(tables.recurring_payments[0]).toMatchObject({
      id: 'premium',
      payee: 'YouTube Premium',
      amount_cents: 1399,
      period: 'month',
      last_charged_on: '2026-10-14',
      next_date: '2026-11-14',
      status: 'active',
    });
    expect(tables.recurring_charges).toHaveLength(8);
    expect(tables.recurring_charges.every((c) => c.payment_id === 'premium')).toBe(true);
  });

  it('files a later email under the merged name on the kept row', async () => {
    const tables = tablesWithYouTube();
    const client = memoryClient(tables);
    await mergePayments(client, { userId: USER, paymentId: 'plain', intoId: 'premium' });

    const plain = await fileRecurringReading(client, youtubeReading('YouTube', '11'));
    const yt = await fileRecurringReading(client, youtubeReading('YT', '12'));

    expect(plain.paymentId).toBe('premium');
    expect(yt.paymentId).toBe('premium');
    expect(tables.recurring_payments).toHaveLength(1);
    expect(tables.recurring_charges).toHaveLength(10);
    expect(tables.recurring_payments[0]).toMatchObject({ next_date: '2027-01-14' });
    expect(tables.recurring_payee_aliases.map((a) => [a.payee_key, a.payment_id]).sort()).toEqual([
      ['youtube', 'premium'],
      ['yt', 'premium'],
    ]);
  });

  it('refuses to merge a payment into itself', async () => {
    const tables = tablesWithYouTube();
    const result = await mergePayments(memoryClient(tables), {
      userId: USER,
      paymentId: 'plain',
      intoId: 'plain',
    });
    expect(result.error).toBeTruthy();
    expect(tables.recurring_payments).toHaveLength(2);
  });

  it("does not merge another person's payments", async () => {
    const tables = tablesWithYouTube();
    const result = await mergePayments(memoryClient(tables), {
      userId: 'someone-else',
      paymentId: 'plain',
      intoId: 'premium',
    });
    expect(result.error).toBeTruthy();
    expect(tables.recurring_payments).toHaveLength(2);
    expect(tables.recurring_charges.filter((c) => c.payment_id === 'plain')).toHaveLength(3);
  });
});
