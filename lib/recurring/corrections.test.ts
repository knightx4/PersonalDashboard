import { describe, expect, it } from 'vitest';
import { billTitle } from '@/lib/todo/agenda/sources/bills';
import { renamePayment } from './corrections';
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
    const result = await renamePayment(memoryClient(tables), { userId: USER, paymentId: 'ui', payee: '   ' });
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
