import { describe, expect, it } from 'vitest';
import type { RecurringExtraction } from './extraction';
import { fileRecurringReading } from './store';
import { memoryClient, type Row } from './memory-client';

/**
 * Filing a reading against an in-memory client. What RLS and the constraints
 * do is the migration's (0122_recurring_payee_aliases.sql).
 */

const USER = 'user-1';

function reading(overrides: Partial<RecurringExtraction>): RecurringExtraction {
  return {
    payee: 'YouTube',
    kind: 'subscription',
    event: 'charge',
    amountCents: 1399,
    previousAmountCents: null,
    currency: 'USD',
    period: 'month',
    occurredOn: '2026-09-01',
    dueOn: null,
    ...overrides,
  };
}

describe('fileRecurringReading', () => {
  it('files a reading whose payee key is an alias on the aliased payment', async () => {
    const tables: Record<string, Row[]> = {
      recurring_payments: [
        { id: 'premium', user_id: USER, payee: 'YouTube Premium', payee_key: 'youtubepremium', kind: 'subscription', status: 'active' },
      ],
      recurring_payee_aliases: [{ id: 'a1', user_id: USER, payee_key: 'youtube', payment_id: 'premium' }],
      recurring_charges: [],
    };
    const client = memoryClient(tables);

    const { paymentId } = await fileRecurringReading(client, {
      userId: USER,
      messageId: 'm1',
      senderDomain: 'youtube.com',
      reading: reading({ payee: 'YouTube' }),
    });

    expect(paymentId).toBe('premium');
    expect(tables.recurring_payments).toHaveLength(1);
    expect(tables.recurring_charges).toMatchObject([{ payment_id: 'premium', message_id: 'm1' }]);
  });

  it("does not use another person's alias", async () => {
    const tables: Record<string, Row[]> = {
      recurring_payments: [],
      recurring_payee_aliases: [{ id: 'a1', user_id: 'someone-else', payee_key: 'youtube', payment_id: 'theirs' }],
      recurring_charges: [],
    };
    const { paymentId } = await fileRecurringReading(memoryClient(tables), {
      userId: USER,
      messageId: 'm1',
      senderDomain: null,
      reading: reading({ payee: 'YouTube' }),
    });
    expect(paymentId).not.toBe('theirs');
    expect(tables.recurring_payments).toMatchObject([{ user_id: USER, payee_key: 'youtube' }]);
  });

  it('keeps an ignored payment ignored after a new charge is filed', async () => {
    const tables: Record<string, Row[]> = {
      recurring_payments: [
        { id: 'chase', user_id: USER, payee: 'Chase', payee_key: 'chase', kind: 'bill', status: 'ignored' },
      ],
      recurring_payee_aliases: [],
      recurring_charges: [],
    };
    await fileRecurringReading(memoryClient(tables), {
      userId: USER,
      messageId: 'm2',
      senderDomain: 'chase.com',
      reading: reading({ payee: 'Chase', kind: 'bill', event: 'bill', amountCents: 2423300, dueOn: '2026-10-20' }),
    });
    expect(tables.recurring_payments[0]).toMatchObject({ status: 'ignored', amount_cents: 2423300 });
  });

  it('still marks an active payment cancelled from a cancellation email', async () => {
    const tables: Record<string, Row[]> = {
      recurring_payments: [
        { id: 'nf', user_id: USER, payee: 'Netflix', payee_key: 'netflix', kind: 'subscription', status: 'active' },
      ],
      recurring_payee_aliases: [],
      recurring_charges: [],
    };
    await fileRecurringReading(memoryClient(tables), {
      userId: USER,
      messageId: 'm3',
      senderDomain: 'netflix.com',
      reading: reading({ payee: 'Netflix', event: 'cancelled', amountCents: null }),
    });
    expect(tables.recurring_payments[0]).toMatchObject({ status: 'cancelled' });
  });
});
