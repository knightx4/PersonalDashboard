import { z } from 'zod';

export const PARSER_VERSION = 'extract-v2';

/** Top-level system category slugs the model may assign. */
export const CATEGORY_SLUGS = [
  'clothing',
  'electronics',
  'home',
  'beauty',
  'health',
  'groceries',
  'hobby',
  'pet',
  'books',
  'other',
] as const;

export type CategorySlug = (typeof CATEGORY_SLUGS)[number];

export const extractedLineSchema = z.object({
  name: z.string().trim().min(1),
  variant: z.string().trim().nullable().optional(),
  quantity: z.number().int().positive(),
  /** Unit price in integer cents. */
  unitPriceCents: z.number().int().nonnegative(),
  /** Canonical product page when present in the email. */
  productUrl: z.preprocess((value) => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return /^https?:\/\//i.test(trimmed) ? trimmed : null;
  }, z.string().url().nullable().optional()),
  imageUrl: z.preprocess((value) => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return /^https?:\/\//i.test(trimmed) ? trimmed : null;
  }, z.string().url().nullable().optional()),
  /** Top-level system category slug (clothing, books, …). */
  categorySlug: z
    .string()
    .trim()
    .toLowerCase()
    .nullable()
    .optional()
    .transform((value) => {
      if (!value) return null;
      return (CATEGORY_SLUGS as readonly string[]).includes(value)
        ? (value as CategorySlug)
        : 'other';
    }),
});

export const extractedOrderSchema = z.object({
  merchantName: z.string().trim().min(1).nullable().optional(),
  merchantSlug: z.string().trim().min(1).nullable().optional(),
  externalOrderNumber: z.string().trim().min(1).nullable().optional(),
  /** YYYY-MM-DD */
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency: z.string().trim().min(1).default('USD'),
  taxCents: z.number().int().nonnegative().default(0),
  shippingCents: z.number().int().nonnegative().default(0),
  discountCents: z.number().int().nonnegative().default(0),
  totalCents: z.number().int().nonnegative(),
  lines: z.array(extractedLineSchema).min(1),
  confidence: z.number().min(0).max(1).optional(),
});

export type ExtractedOrder = z.infer<typeof extractedOrderSchema>;

export type MessageClassification =
  | 'order_confirmation'
  | 'shipping'
  | 'delivery'
  | 'return'
  | 'cancellation'
  | 'not_relevant';
