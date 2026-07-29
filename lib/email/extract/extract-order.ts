import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { applyExtraction, type ApplyExtractionResult } from './apply';
import { heuristicExtractOrder } from './heuristic';
import { guessCategorySlug } from './guess-category';
import {
  enrichLinesWithProductLinks,
  extractProductLinksFromEmail,
} from './product-links';
import { CATEGORY_SLUGS, PARSER_VERSION, type ExtractedOrder } from './schema';

const SYSTEM = `You extract structured purchase order data from retailer order-confirmation emails.
Return ONLY a JSON object with these fields:
- merchantName (string|null)
- merchantSlug (string|null) — lowercase kebab if known (amazon, target, …)
- externalOrderNumber (string|null)
- orderDate (YYYY-MM-DD)
- currency (default USD)
- taxCents, shippingCents, discountCents, totalCents (integers, cents)
- lines: [{ name, variant|null, quantity (int), unitPriceCents (int), productUrl|null, imageUrl|null, categorySlug|null }]
- confidence (0-1)

categorySlug must be one of: ${CATEGORY_SLUGS.join(', ')}.
Use books for books/ebooks/audiobooks; electronics for gadgets; home for furniture/kitchen/decor; clothing for apparel; groceries for food/drink; hobby for games/crafts/sports gear; pet for pet supplies; beauty/health as appropriate; other if unsure.

Rules:
- Money is integer cents only (12.99 → 1299).
- quantity * unitPriceCents + tax + shipping - discount must equal totalCents (±2 cents).
- Prefer line items that appear in the email; do not invent products.
- Always emit a separate lines[] entry for every ordered product. Never collapse "and N more item" subjects into a single line.
- productUrl: only a real product page URL from the email (amazon.com/dp/…, etc). Never invent.
- If this is not an order confirmation, return {"error":"not_an_order"}.`;

function attachProductLinks(
  order: ExtractedOrder,
  html?: string | null,
  text?: string,
): ExtractedOrder {
  const blob = `${html ?? ''}\n${text ?? ''}`;
  const hints = extractProductLinksFromEmail(blob);
  if (hints.length === 0) return order;
  return {
    ...order,
    lines: enrichLinesWithProductLinks(order.lines, hints, blob),
  };
}

function fillMissingCategories(
  order: ExtractedOrder,
  input: { subject: string; text?: string; merchantSlug?: string | null },
): ExtractedOrder {
  return {
    ...order,
    lines: order.lines.map((line) => {
      if (line.categorySlug) return line;
      const guessed = guessCategorySlug({
        name: line.name,
        merchantSlug: input.merchantSlug ?? order.merchantSlug,
        subject: input.subject,
        text: input.text,
      });
      return guessed ? { ...line, categorySlug: guessed } : line;
    }),
  };
}

function enrichExtractedOrder(
  order: ExtractedOrder,
  input: {
    subject: string;
    text: string;
    html?: string | null;
    merchantSlug?: string | null;
  },
): ExtractedOrder {
  return fillMissingCategories(
    attachProductLinks(order, input.html, input.text),
    input,
  );
}

export async function extractOrderFromEmail(input: {
  subject: string;
  text: string;
  html?: string | null;
  merchantSlug?: string | null;
  merchantName?: string | null;
  fromAddress?: string | null;
  receivedAt?: Date | null;
  apiKey?: string | null;
}): Promise<{
  result: ApplyExtractionResult;
  source: 'llm' | 'heuristic';
  parserVersion: string;
  raw?: unknown;
}> {
  const apiKey = input.apiKey ?? process.env.ANTHROPIC_API_KEY;

  if (apiKey) {
    try {
      const client = new Anthropic({ apiKey });
      const truncated = input.text.slice(0, 14_000);
      const message = await client.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1800,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: `Subject: ${input.subject}\n\nBody:\n${truncated}`,
          },
        ],
      });
      const textBlock = message.content.find((b) => b.type === 'text');
      const text = textBlock && textBlock.type === 'text' ? textBlock.text : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const raw = JSON.parse(jsonMatch[0]) as unknown;
        if (
          raw &&
          typeof raw === 'object' &&
          'error' in raw &&
          (raw as { error: unknown }).error === 'not_an_order'
        ) {
          return {
            result: { ok: false, reason: 'schema', issues: ['not_an_order'] },
            source: 'llm',
            parserVersion: PARSER_VERSION,
            raw,
          };
        }
        const result = applyExtraction(raw);
        if (result.ok) {
          return {
            result: {
              ...result,
              order: enrichExtractedOrder(result.order, input),
            },
            source: 'llm',
            parserVersion: PARSER_VERSION,
            raw,
          };
        }
        // Fall through to heuristic if LLM failed reconcile/schema.
      }
    } catch (err) {
      console.error('llm extract failed', err);
    }
  }

  const heuristic = heuristicExtractOrder(input);
  if (!heuristic) {
    return {
      result: { ok: false, reason: 'schema', issues: ['no_extraction'] },
      source: 'heuristic',
      parserVersion: PARSER_VERSION,
    };
  }
  const applied = applyExtraction(heuristic);
  if (!applied.ok) {
    return {
      result: applied,
      source: 'heuristic',
      parserVersion: PARSER_VERSION,
      raw: heuristic,
    };
  }
  return {
    result: {
      ...applied,
      order: enrichExtractedOrder(applied.order, input),
    },
    source: 'heuristic',
    parserVersion: PARSER_VERSION,
    raw: heuristic,
  };
}

export type { ExtractedOrder };
