import type { LinkedInArchive, ReceiptRecord } from '@/lib/linkedin/archive';
import { ref } from '../engine';
import type { ImportMapper, MappedRecord, MatchSkip } from '../types';

// LinkedIn Learning courses and LinkedIn charges (plan #2432.8). Four kinds:
//
//   learning            each course or video becomes a learn.learning_log
//                       entry, the table log_learning writes, with the title as
//                       topic and the description in the summary. The export
//                       says watched, not completed, so the summary says so.
//                       No subject and no ideas: nothing is credited.
//   orders              each receipt becomes an order from the LinkedIn
//                       merchant, keyed by invoice number. Status is left to
//                       sync_order_state.
//   recurring_payments  one per product that recurs (Premium, or any product
//                       charged twice), joined to the payment the person's mail
//                       already found when the payee matches.
//   recurring_charges   each receipt of such a product, filed on its payment.

/** The shared merchant migration 0267 seeds. */
export const LINKEDIN_MERCHANT_ID = '6c1f0a52-3b7e-4d8a-9e21-4a5b7c9d0e13';

const DAY = 24 * 60 * 60 * 1000;
const MAX_TOPIC = 200;
const MAX_SUMMARY = 4000;

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

// ── learning ────────────────────────────────────────────────────────────────

export const linkedInLearning: ImportMapper<LinkedInArchive> = {
  kind: 'learning',
  table: 'learn.learning_log',
  columns: { topic: 'text', summary: 'text', created_at: 'timestamptz' },
  records(archive) {
    return archive.learning.map((c): MappedRecord => {
      const when = c.lastWatchedAt ?? c.completedAt ?? (archive.exportedOn ? `${archive.exportedOn}T00:00:00Z` : null);
      if (!when) return { key: c.key, skip: 'It has no watched date and the export’s date is unknown.' };
      const status = c.completedAt ? 'Completed' : 'Watched';
      const kindOf = c.contentType ? c.contentType.toLowerCase() : 'course';
      const lead = `${status} on LinkedIn Learning (${kindOf}).`;
      const summary = c.description ? `${lead} ${c.description}` : lead;
      return {
        key: c.key,
        values: { topic: clip(c.title, MAX_TOPIC), summary: clip(summary, MAX_SUMMARY), created_at: when },
      };
    });
  },
};

// ── receipts ────────────────────────────────────────────────────────────────

function cents(amount: number | null): number | null {
  return amount === null ? null : Math.round(amount * 100);
}

function payeeOf(productName: string): string {
  const name = productName.trim();
  return clip(/^linkedin\b/i.test(name) ? name : `LinkedIn ${name}`, 200);
}

function payeeKeyOf(productName: string): string {
  return payeeOf(productName).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 120);
}

function dayOf(receipt: ReceiptRecord): string | null {
  return receipt.transactionAt ? receipt.transactionAt.slice(0, 10) : null;
}

function currencyOf(receipt: ReceiptRecord): string {
  const c = (receipt.currency ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : 'USD';
}

function periodOf(receipt: ReceiptRecord): string | null {
  const text = `${receipt.billingPeriod ?? ''} ${receipt.productName ?? ''}`.toLowerCase();
  if (/annual|year/.test(text)) return 'year';
  if (/month/.test(text)) return 'month';
  return null;
}

/** Why a receipt cannot become an order, or null. orders_date_sane_ck allows today ±3 years. */
function orderSkip(r: ReceiptRecord): string | null {
  const day = dayOf(r);
  if (!day) return 'It has no date.';
  if (r.totalAmount === null) return 'It has no total.';
  if (r.totalAmount < 0) return 'It is a refund or credit, not a charge.';
  const t = Date.parse(`${day}T00:00:00Z`);
  const now = Date.now();
  if (t > now + DAY) return 'It is dated in the future.';
  if (t < now - 365 * 3 * DAY) return 'It is more than three years old, which an order cannot be.';
  return null;
}

/** Receipts whose product recurs: Premium, or anything charged more than once. */
function recurringGroups(archive: LinkedInArchive): Map<string, ReceiptRecord[]> {
  const byKey = new Map<string, ReceiptRecord[]>();
  for (const r of archive.receipts) {
    if (!r.productName || !dayOf(r) || r.totalAmount === null || r.totalAmount < 0) continue;
    const key = payeeKeyOf(r.productName);
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), r]);
  }
  for (const [key, list] of byKey) {
    if (list.length < 2 && !/premium/i.test(list[0].productName ?? '')) byKey.delete(key);
  }
  return byKey;
}

export const linkedInOrders: ImportMapper<LinkedInArchive> = {
  kind: 'orders',
  table: 'public.orders',
  columns: {
    merchant_id: 'uuid',
    source: 'text',
    external_order_number: 'text',
    order_date: 'date',
    subtotal_cents: 'number',
    tax_cents: 'number',
    total_cents: 'number',
    currency: 'text',
  },
  records(archive) {
    return archive.receipts.map((r): MappedRecord => {
      const skip = orderSkip(r);
      if (skip) return { key: r.key, skip };
      const total = cents(r.totalAmount)!;
      const tax = cents(r.taxAmount) ?? 0;
      return {
        key: r.key,
        values: {
          merchant_id: LINKEDIN_MERCHANT_ID,
          source: 'manual',
          external_order_number: r.invoiceNumber,
          order_date: dayOf(r),
          subtotal_cents: cents(r.subTotal) ?? total - tax,
          tax_cents: tax,
          total_cents: total,
          currency: currencyOf(r),
        },
      };
    });
  },
  // An order the person already has under this invoice number is joined, so the
  // unique (user, merchant, invoice) index is never hit.
  async match(pending, store) {
    const out = new Map<string, string | MatchSkip>();
    const numbers = pending.map((p) => p.values.external_order_number).filter((n) => typeof n === 'string');
    if (numbers.length === 0) return out;
    const rows = await store.rowsWhere('public.orders', ['external_order_number', 'merchant_id'], 'external_order_number', numbers);
    const byNumber = new Map(
      rows.filter((r) => r.merchant_id === LINKEDIN_MERCHANT_ID).map((r) => [String(r.external_order_number), String(r.id)]),
    );
    for (const p of pending) {
      const id = byNumber.get(String(p.values.external_order_number));
      if (id) out.set(p.key, id);
    }
    return out;
  },
};

export const linkedInRecurringPayments: ImportMapper<LinkedInArchive> = {
  kind: 'recurring_payments',
  table: 'public.recurring_payments',
  columns: { payee: 'text', payee_key: 'text', kind: 'text', amount_cents: 'number', currency: 'text', period: 'text' },
  records(archive) {
    return [...recurringGroups(archive)].map(([key, list]): MappedRecord => {
      const latest = [...list].sort((a, b) => (dayOf(b) ?? '').localeCompare(dayOf(a) ?? ''))[0];
      return {
        key,
        values: {
          payee: payeeOf(latest.productName!),
          payee_key: key,
          kind: 'subscription',
          amount_cents: cents(latest.totalAmount),
          currency: currencyOf(latest),
          period: list.map(periodOf).find(Boolean) ?? null,
        },
      };
    });
  },
  async match(pending, store) {
    const rows = await store.rowsWhere('public.recurring_payments', ['payee_key'], 'payee_key', pending.map((p) => p.values.payee_key));
    const byKey = new Map(rows.map((r) => [String(r.payee_key), String(r.id)]));
    const out = new Map<string, string | MatchSkip>();
    for (const p of pending) {
      const id = byKey.get(String(p.values.payee_key));
      if (id) out.set(p.key, id);
    }
    return out;
  },
};

export const linkedInRecurringCharges: ImportMapper<LinkedInArchive> = {
  kind: 'recurring_charges',
  table: 'public.recurring_charges',
  columns: { payment_id: 'uuid', event: 'text', amount_cents: 'number', currency: 'text', period: 'text', occurred_on: 'date' },
  records(archive) {
    const out: MappedRecord[] = [];
    for (const [paymentKey, list] of recurringGroups(archive)) {
      for (const r of list) {
        out.push({
          key: r.key,
          values: {
            payment_id: ref('recurring_payments', paymentKey),
            event: 'charge',
            amount_cents: cents(r.totalAmount),
            currency: currencyOf(r),
            period: periodOf(r),
            occurred_on: dayOf(r),
          },
        });
      }
    }
    return out;
  },
};

export const LINKEDIN_PURCHASE_MAPPERS: ImportMapper<LinkedInArchive>[] = [
  linkedInLearning,
  linkedInOrders,
  linkedInRecurringPayments,
  linkedInRecurringCharges,
];
