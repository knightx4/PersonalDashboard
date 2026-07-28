import { z } from 'zod';

export const PARSER_VERSION = 'extract-v1';

export const extractedLineSchema = z.object({
  name: z.string().trim().min(1),
  variant: z.string().trim().nullable().optional(),
  quantity: z.number().int().positive(),
  /** Unit price in integer cents. */
  unitPriceCents: z.number().int().nonnegative(),
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
