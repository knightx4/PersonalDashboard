import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RecurringExtraction } from './extraction';
import { fileRecurringReading } from './store';

/**
 * Filing a reading against an in-memory client: tables are arrays of rows,
 * and the query chain supports the filters the store uses. What RLS and the
 * constraints do is the migration's (0122_recurring_payee_aliases.sql).
 */

type Row = Record<string, unknown>;

function memoryClient(tables: Record<string, Row[]>) {
  let nextId = 1;
  const client = {
    from(table: string) {
      const rows = (tables[table] ??= []);
      const filters: [string, unknown][] = [];
      let op: 'select' | 'insert' | 'upsert' | 'update' = 'select';
      let payload: Row | null = null;
      let upsertKeys: string[] = [];
      const matching = () => rows.filter((r) => filters.every(([k, v]) => r[k] === v));
      const run = () => {
        if (op === 'insert') {
          const row = { id: `${table}-${nextId++}`, created_at: '2026-09-29T00:00:00Z', ...payload };
          rows.push(row);
          return { data: [row], error: null };
        }
        if (op === 'upsert') {
          const clash = rows.find((r) => upsertKeys.every((k) => r[k] === payload![k]));
          if (clash) return { data: [], error: null };
          const row = { id: `${table}-${nextId++}`, status: 'active', ...payload };
          rows.push(row);
          return { data: [row], error: null };
        }
        if (op === 'update') {
          for (const r of matching()) Object.assign(r, payload);
          return { data: null, error: null };
        }
        return { data: matching(), error: null };
      };
      const chain = {
        select: () => chain,
        eq: (k: string, v: unknown) => (filters.push([k, v]), chain),
        insert: (row: Row) => ((op = 'insert'), (payload = row), chain),
        upsert: (row: Row, o: { onConflict: string }) => (
          (op = 'upsert'), (payload = row), (upsertKeys = o.onConflict.split(',')), chain
        ),
        update: (row: Row) => ((op = 'update'), (payload = row), chain),
        maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
        single: async () => ({ data: matching()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => void) => resolve(run()),
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  return client;
}

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
