/**
 * An order from a sentence typed into capture (plan #1950.3.1): "a kettle
 * from Target for $34.99 yesterday" becomes an order with one line. The
 * model reads the sentence through one tool (lib/orders/sentence-model.ts);
 * this file is the part with no model in it, so it is tested without one:
 * the tool's shape, checking what came back, and the reading used when there
 * is no model to ask.
 *
 * One press always makes the order. A sentence the model cannot read, or no
 * model at all, still makes one line named by the sentence, with the first
 * amount in it as the price, and the order's page is where it is put right.
 */

import { CATEGORY_SLUGS, normalizeCategorySlug } from '@/lib/email/extract/schema';

export type OrderDraftLine = {
  name: string;
  /** Set when the line is read from an email, which states a size or colour. */
  variant?: string | null;
  quantity: number;
  unitPriceCents: number;
  categorySlug: string | null;
};

export type OrderDraft = {
  merchantName: string | null;
  /** YYYY-MM-DD. */
  orderDate: string;
  lines: OrderDraftLine[];
};

export const ORDER_SENTENCE_TOOL = 'read_order';

/** The most lines one sentence makes; more is a receipt, not a sentence. */
export const MAX_SENTENCE_LINES = 10;

/** The tool the model reports through. */
export const ORDER_SENTENCE_SCHEMA = {
  type: 'object',
  properties: {
    merchant: { type: ['string', 'null'], description: 'The shop, as named. Null when none is named.' },
    order_date: {
      type: ['string', 'null'],
      description: 'YYYY-MM-DD, worked out from today when the sentence says "yesterday" or a weekday. Null when it names no day.',
    },
    lines: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_SENTENCE_LINES,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'What was bought, as a short product name.' },
          quantity: { type: 'integer', minimum: 1 },
          unit_price: { type: ['number', 'null'], description: 'The price of one, in dollars. Null when none is given.' },
          category: { type: ['string', 'null'], enum: [...CATEGORY_SLUGS, null] },
        },
        required: ['name', 'quantity'],
      },
    },
  },
  required: ['lines'],
} as const;

/** The message the model is sent: today, then the sentence. */
export function orderSentenceMessage(sentence: string, today: string): string {
  return `Today is ${today}.\n\nWhat they typed:\n${sentence.trim()}`;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The orders table refuses a day more than three years back or after tomorrow. */
function saneDay(value: unknown, today: string): string {
  if (typeof value !== 'string' || !DAY.test(value)) return today;
  const day = Date.parse(`${value}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(day) || day > now + 86_400_000 || day < now - 3 * 365 * 86_400_000) return today;
  return value;
}

function cents(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 100);
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : flat.slice(0, max).trimEnd();
}

/**
 * The model's reply, checked: lines with no name are left out, a quantity is
 * a whole number of at least one, a price is whole cents, and a day the
 * orders table would refuse is today. Null when no line is left.
 */
export function readOrderSentenceReply(reply: unknown, today: string): OrderDraft | null {
  if (!reply || typeof reply !== 'object') return null;
  const raw = reply as { merchant?: unknown; order_date?: unknown; lines?: unknown };
  const lines: OrderDraftLine[] = [];
  for (const entry of Array.isArray(raw.lines) ? raw.lines.slice(0, MAX_SENTENCE_LINES) : []) {
    if (!entry || typeof entry !== 'object') continue;
    const line = entry as { name?: unknown; quantity?: unknown; unit_price?: unknown; category?: unknown };
    const name = typeof line.name === 'string' ? clip(line.name, 200) : '';
    if (!name) continue;
    const quantity =
      typeof line.quantity === 'number' && Number.isInteger(line.quantity) && line.quantity >= 1
        ? Math.min(line.quantity, 999)
        : 1;
    lines.push({
      name,
      quantity,
      unitPriceCents: cents(line.unit_price),
      categorySlug: normalizeCategorySlug(line.category),
    });
  }
  if (lines.length === 0) return null;
  const merchant = typeof raw.merchant === 'string' ? clip(raw.merchant, 120) : '';
  return { merchantName: merchant || null, orderDate: saneDay(raw.order_date, today), lines };
}

const AMOUNT = /\$\s?(\d+(?:,\d{3})*(?:\.\d{1,2})?)|(\d+(?:\.\d{2}))\s?(?:dollars|usd)?\b/i;

/**
 * The sentence as one line, when there is no model to read it: the first
 * amount in it is the price, and the words around it are the name.
 */
export function orderFromSentenceAlone(sentence: string, today: string): OrderDraft {
  const match = sentence.match(AMOUNT);
  const amount = match ? Number((match[1] ?? match[2]).replace(/,/g, '')) : 0;
  const name = clip(match ? sentence.replace(match[0], ' ') : sentence, 200).replace(/\s+(for|at)$/i, '');
  return {
    merchantName: null,
    orderDate: today,
    lines: [{ name: name || clip(sentence, 200), quantity: 1, unitPriceCents: cents(amount), categorySlug: null }],
  };
}

/** What the order is called in the toast and the record: its first line, and how many more. */
export function orderDraftTitle(draft: OrderDraft): string {
  const [first, ...rest] = draft.lines;
  const more = rest.length > 0 ? ` and ${rest.length} more` : '';
  return draft.merchantName ? `${first.name}${more} from ${draft.merchantName}` : `${first.name}${more}`;
}
