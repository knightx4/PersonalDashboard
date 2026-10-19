import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importLinkedIn } from '../linkedin';
import { memoryStore } from '../memory-store';
import { LINKEDIN_MERCHANT_ID, LINKEDIN_PURCHASE_MAPPERS } from './purchases';

// The fixture export has one course (Product Discovery, completed) and one
// receipt (Premium Career, INV-0001, 43.19 USD on 2026-05-01).

const zip = new Uint8Array(readFileSync(join(__dirname, '../../linkedin/archive/fixtures/export.zip')));
const mappers = LINKEDIN_PURCHASE_MAPPERS;
const archiveDate = '2026-12-01';

describe('importing LinkedIn Learning and receipts', () => {
  it('logs the course, files the receipt as an order on a recurring payment, and a rerun adds nothing', async () => {
    const store = memoryStore();
    await importLinkedIn(store, zip, { dryRun: false, mappers, archiveDate });

    const [log] = store.rows('learn.learning_log');
    expect(log).toMatchObject({ topic: 'Product Discovery' });
    expect(String(log.summary)).toContain('How to find what to build.');

    const [order] = store.rows('public.orders');
    expect(order).toMatchObject({
      merchant_id: LINKEDIN_MERCHANT_ID,
      external_order_number: 'INV-0001',
      order_date: '2026-05-01',
      total_cents: 4319,
      tax_cents: 320,
      currency: 'USD',
    });

    const [payment] = store.rows('public.recurring_payments');
    expect(payment).toMatchObject({ payee: 'LinkedIn Premium Career', payee_key: 'linkedinpremiumcareer', amount_cents: 4319 });
    const [charge] = store.rows('public.recurring_charges');
    expect(charge).toMatchObject({ payment_id: payment.id, occurred_on: '2026-05-01', amount_cents: 4319 });

    const again = await importLinkedIn(store, zip, { dryRun: false, mappers, archiveDate });
    expect(again.plan.totals.added).toBe(0);
    expect(store.rows('learn.learning_log')).toHaveLength(1);
    expect(store.rows('public.orders')).toHaveLength(1);
    expect(store.rows('public.recurring_charges')).toHaveLength(1);
  });

  it('joins the recurring payment the person’s mail already found', async () => {
    const store = memoryStore({
      'public.recurring_payments': [{ id: 'p1', user_id: 'u', payee: 'LinkedIn Premium Career', payee_key: 'linkedinpremiumcareer', amount_cents: null, currency: 'USD', period: null, kind: 'subscription' }],
    });
    await importLinkedIn(store, zip, { dryRun: false, mappers, archiveDate });
    expect(store.rows('public.recurring_payments')).toHaveLength(1);
    expect(store.rows('public.recurring_charges')[0].payment_id).toBe('p1');
  });
});
