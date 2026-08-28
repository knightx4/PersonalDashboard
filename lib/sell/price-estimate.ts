/**
 * Shape and validation for a resale price estimate.
 *
 * Deliberately free of server-only imports so the parsing rules — which are
 * where the judgement lives — can be tested directly.
 */
import { z } from 'zod';

export const priceEstimateSchema = z.object({
  /** Cheapest realistic used price seen. */
  low_cents: z.number().int().nonnegative(),
  /** What a used copy actually sells for — the number we route on. */
  typical_cents: z.number().int().nonnegative(),
  high_cents: z.number().int().nonnegative(),
  currency: z.string().default('USD'),
  confidence: z.enum(['high', 'medium', 'low']),
  /** One line on what the number is based on. */
  basis: z.string().nullable().optional(),
  sources: z
    .array(z.object({ title: z.string().nullable().optional(), url: z.string() }))
    .max(6)
    .optional()
    .default([]),
  /** True when nothing usable was found — better than a guessed number. */
  no_data: z.boolean().optional().default(false),
});

export type PriceEstimate = z.infer<typeof priceEstimateSchema>;

export type EstimateResult =
  | { ok: true; estimate: PriceEstimate }
  | { ok: false; error: string };

/** Validate a reported payload into an estimate, or explain why not. */
export function parseEstimatePayload(raw: unknown): EstimateResult {
  const parsed = priceEstimateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: 'The price report came back in an unexpected shape.' };
  }
  const estimate = parsed.data;
  if (estimate.no_data) return { ok: false, error: 'No usable price data found.' };
  if (estimate.typical_cents <= 0) {
    return { ok: false, error: 'No usable price data found.' };
  }
  // A range that does not contain its own midpoint means the model was
  // guessing; treat that as no data rather than routing on it.
  if (estimate.low_cents > estimate.typical_cents || estimate.typical_cents > estimate.high_cents) {
    return { ok: false, error: 'The reported price range was inconsistent.' };
  }
  return { ok: true, estimate };
}
