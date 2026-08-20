import { z } from 'zod';

export const PARSER_VERSION = 'extract-v5';

/** Top-level system category slugs (always allowed). */
export const CATEGORY_SLUGS = [
  'clothing',
  'electronics',
  'home',
  'kitchen',
  'beauty',
  'health',
  'groceries',
  'hobby',
  'pet',
  'books',
  'other',
] as const;

export type CategorySlug = (typeof CATEGORY_SLUGS)[number];

export type CategoryOption = {
  slug: string;
  name: string;
};

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Normalize a model/heuristic category slug; keep kebab-case, else null. */
export function normalizeCategorySlug(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '-');
  if (!normalized || !SLUG_RE.test(normalized)) return null;
  return normalized;
}

export function isSystemCategorySlug(slug: string): slug is CategorySlug {
  return (CATEGORY_SLUGS as readonly string[]).includes(slug);
}

export const extractedLineSchema = z.object({
  name: z.string().trim().min(1),
  /** Short human title for list UIs (2–6 words). */
  shortName: z.string().trim().min(1).max(80).nullable().optional(),
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
  /** System or user category slug (clothing, books, camping, …). */
  categorySlug: z.preprocess(
    (value) => normalizeCategorySlug(value),
    z.string().nullable().optional(),
  ),
  /**
   * Synonym-friendly search tokens (makeup, lipstick, …).
   * Optional — server also derives tags heuristically.
   */
  searchTags: z
    .array(z.string().trim().min(1).max(32))
    .max(24)
    .nullable()
    .optional(),
  /**
   * Human-facing labels (shoes, sneakers) — distinct from categorySlug
   * (clothing) and from searchTags synonyms.
   */
  tags: z
    .array(z.string().trim().min(1).max(40))
    .max(8)
    .nullable()
    .optional(),
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

/** Drop category slugs that are not in the allowed set (system + user's custom). */
export function restrictCategorySlugs(
  order: ExtractedOrder,
  allowedSlugs: ReadonlySet<string>,
): ExtractedOrder {
  return {
    ...order,
    lines: order.lines.map((line) => {
      const slug = line.categorySlug ?? null;
      if (!slug) return { ...line, categorySlug: null };
      if (allowedSlugs.has(slug)) return line;
      // Legacy models sometimes emit unknown labels → fall back to other when present.
      if (allowedSlugs.has('other')) return { ...line, categorySlug: 'other' };
      return { ...line, categorySlug: null };
    }),
  };
}
