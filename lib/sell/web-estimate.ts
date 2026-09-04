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
import {
  parseEstimatePayload,
  type EstimateResult,
} from '@/lib/sell/price-estimate';
import type { ExpectedPriceSource, PriceSubject } from '@/lib/sell/expected-price';
import type { PriceEvidence } from '@/lib/sell/price-evidence';

/**
 * Reading a few search results and reporting a number is not a reasoning
 * problem — Haiku does it for a fifth of Opus's token price, and the search
 * fee dominates the bill anyway.
 */
const MODEL = 'claude-haiku-4-5';
const TOOL_NAME = 'report_price';

/** Each search is billed. Two is enough to cross-check a price. */
const MAX_SEARCHES = 2;

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
      max_tokens: 1024,
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

  async expectedSelfListCentsFor(subject: PriceSubject): Promise<number | null> {
    const result = await estimateResalePrice(this.options, {
      label: subject.query,
      hint: subject.hint ?? null,
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

  async priceEvidenceForIsbn(isbn13: string): Promise<PriceEvidence | null> {
    return this.evidence({
      label: `Book, ISBN ${isbn13}`,
      hint: 'Used copy in good condition, sold on eBay / Amazon marketplace / AbeBooks.',
    });
  }

  async priceEvidence(subject: PriceSubject): Promise<PriceEvidence | null> {
    return this.evidence({ label: subject.query, hint: subject.hint ?? null });
  }

  /**
   * The estimate as evidence.
   *
   * `listings` carries the pages the search read, which is the closest thing
   * this source has to a comp -- they are citations, so they have no price of
   * their own, and the panel shows them as links rather than as offers.
   */
  private async evidence(subject: {
    label: string;
    hint?: string | null;
  }): Promise<PriceEvidence | null> {
    const result = await estimateResalePrice(this.options, subject);
    if (!result.ok) return null;
    const { estimate } = result;
    return {
      source: 'web_estimate',
      typicalCents: estimate.typical_cents,
      lowCents: estimate.low_cents,
      highCents: estimate.high_cents,
      medianCents: null,
      // Neither rule applies: the model judged a range, it did not read a
      // distribution, so claiming a percentile or a median would be a fiction.
      typicalBasis: null,
      // Not a count of listings: the model read pages, it did not enumerate a
      // market, and reporting its citation count as a sample size would imply
      // a rigour that is not there.
      sampleSize: null,
      totalMatches: null,
      listings: (estimate.sources ?? []).map((source) => ({
        title: source.title ?? null,
        url: source.url,
        priceCents: null,
        shippingCents: null,
        condition: null,
      })),
      note: estimate.basis ?? `Confidence: ${estimate.confidence}.`,
      query: subject.label,
      fetchedAt: new Date().toISOString(),
    };
  }
}
