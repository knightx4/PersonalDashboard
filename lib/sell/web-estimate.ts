/**
 * Price estimates from a web search, for when there is no market API.
 *
 * eBay's Browse API is the real answer, but approval takes days and the sell
 * assistant is useless without a number. Claude's server-side web search reads
 * what a used copy is actually going for right now and reports a range with
 * its sources. It uses the Anthropic key the app already has, so it needs no
 * new account.
 *
 * This is explicitly a softer signal than sold comps, and the UI says so —
 * asking prices found on the open web run high, so the estimate returned is
 * the typical realised price rather than the top of the range.
 */
import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { ExpectedPriceSource } from '@/lib/sell/expected-price';

const MODEL = 'claude-opus-5';
const TOOL_NAME = 'report_price';

/** Enough searches to cross-check two or three listings, not a research project. */
const MAX_SEARCHES = 4;

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

const SYSTEM = `You price second-hand goods for a personal resale assistant.

Search for what the item currently SELLS for used, in USD, in the US market.
Rules:
- Prefer completed/sold prices over asking prices. Asking prices run high;
  say so in basis when that is all you can find.
- Price the ordinary used copy, not signed, first-printing, collector, or
  shrink-wrapped outliers. Ignore obviously broken listings (a $900 paperback).
- typical_cents is what a normal used copy realistically fetches — the number
  the assistant will act on. low/high bound the range you saw.
- If you cannot find real data, set no_data true and leave the numbers at 0.
  A guess is worse than nothing here.
- All money in integer US cents.`;

/** Pure: validate a tool payload into an estimate. Exported for tests. */
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

export type WebEstimateOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Anthropic;
};

/**
 * Ask for one item's going rate. `subject` should be as specific as possible —
 * an ISBN pins the edition, a bare title does not.
 */
export async function estimateResalePrice(
  options: WebEstimateOptions,
  subject: { label: string; hint?: string | null },
): Promise<EstimateResult> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM,
      tools: [
        // Server-side web search: Anthropic runs it, results come back inline.
        {
          type: 'web_search_20260209',
          name: 'web_search',
          max_uses: MAX_SEARCHES,
        } as unknown as Anthropic.Tool,
        {
          name: TOOL_NAME,
          description: 'Report the used-market price for the item.',
          input_schema: {
            type: 'object',
            properties: {
              low_cents: { type: 'integer' },
              typical_cents: { type: 'integer' },
              high_cents: { type: 'integer' },
              currency: { type: 'string' },
              confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
              basis: { type: ['string', 'null'] },
              sources: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    title: { type: ['string', 'null'] },
                    url: { type: 'string' },
                  },
                  required: ['url'],
                },
              },
              no_data: { type: 'boolean' },
            },
            required: ['low_cents', 'typical_cents', 'high_cents', 'confidence'],
          },
        },
      ],
      messages: [
        {
          role: 'user',
          content: `What does this sell for used right now? ${subject.label}${
            subject.hint ? `\n${subject.hint}` : ''
          }\n\nSearch, then call ${TOOL_NAME}.`,
        },
      ],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, error: 'Price lookups are rate-limited right now.' };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, error: `Price lookup failed (${error.status}).` };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Price lookup failed.',
    };
  }

  const report = response.content.find(
    (block) => block.type === 'tool_use' && block.name === TOOL_NAME,
  );
  if (!report || report.type !== 'tool_use') {
    return { ok: false, error: 'No price report came back.' };
  }
  return parseEstimatePayload(report.input);
}

/**
 * ExpectedPriceSource backed by web search. Slots in wherever the eBay source
 * would go, so the router does not care which one produced the number.
 */
export class WebSearchExpectedPriceSource implements ExpectedPriceSource {
  constructor(private readonly options: WebEstimateOptions) {}

  async expectedSelfListCents(isbn13: string): Promise<number | null> {
    const result = await estimateResalePrice(this.options, {
      label: `Book, ISBN ${isbn13}`,
      hint: 'Used copy in good condition, sold on eBay / Amazon marketplace / AbeBooks.',
    });
    return result.ok ? result.estimate.typical_cents : null;
  }

  /** Same call, but keeps the range and sources for display. */
  async detailedEstimate(subject: {
    label: string;
    hint?: string | null;
  }): Promise<EstimateResult> {
    return estimateResalePrice(this.options, subject);
  }
}
