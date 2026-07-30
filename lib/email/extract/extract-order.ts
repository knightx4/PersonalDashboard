import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { applyExtraction, type ApplyExtractionResult } from './apply';
import { parseAmazonQuantityLines } from './amazon-lines';
import { heuristicExtractOrder } from './heuristic';
import { guessCategorySlug } from './guess-category';
import {
  enrichLinesWithProductLinks,
  extractProductLinksFromEmail,
} from './product-links';
import { enrichItemDisplay } from '@/lib/inventory/enrich-display';
import { parseShopifyQuantityLines } from './shopify-lines';
import {
  CATEGORY_SLUGS,
  PARSER_VERSION,
  restrictCategorySlugs,
  type CategoryOption,
  type ExtractedOrder,
} from './schema';

function defaultCategoryOptions(): CategoryOption[] {
  return CATEGORY_SLUGS.map((slug) => ({
    slug,
    name: slug.charAt(0).toUpperCase() + slug.slice(1),
  }));
}

function buildSystemPrompt(categories: readonly CategoryOption[]): string {
  const slugList = categories.map((c) => c.slug).join(', ');
  const namedList = categories.map((c) => `${c.slug}="${c.name}"`).join('; ');
  return `You extract structured purchase order data from retailer order-confirmation emails.
Return ONLY a JSON object with these fields:
- merchantName (string|null)
- merchantSlug (string|null) — lowercase kebab if known (amazon, target, …)
- externalOrderNumber (string|null)
- orderDate (YYYY-MM-DD)
- currency (default USD)
- taxCents, shippingCents, discountCents, totalCents (integers, cents)
- lines: [{ name, shortName, searchTags, variant|null, quantity (int), unitPriceCents (int), productUrl|null, imageUrl|null, categorySlug|null }]
- confidence (0-1)

categorySlug must be one of: ${slugList}.
Category labels: ${namedList}.
Prefer a custom/user category when the product clearly fits that label; otherwise use the best system fit. Use other only when unsure and other is available.
Use kitchen for cookware, utensils, bakeware, and small kitchen appliances (not groceries).

For each line also provide:
- shortName: a clear 2–6 word product title people would scan in a list. Strip SEO filler, brand spam, and comma-lists. Keep the distinctive product identity (e.g. "Wood furniture repair kit", "Soft Pinch liquid blush").
- searchTags: 4–12 lowercase synonym tokens for finding this item later (e.g. lipstick → ["makeup","lipstick","cosmetics","beauty","lip"]). Include category-adjacent words even when absent from the title.

Rules:
- Money is integer cents only (12.99 → 1299).
- quantity * unitPriceCents + tax + shipping - discount must equal totalCents (±2 cents).
- Prefer line items that appear in the email; do not invent products.
- Always emit a separate lines[] entry for every ordered product. Never collapse "and N more item" subjects into a single line.
- Shopify-style bodies list "Product name × qty" then optional variant then "$12.00" — use the product name, not the store name.
- merchantName: prefer the store/From display name (e.g. "Ms Betters"), not "Unknown".
- productUrl: only a real product page URL from the email (amazon.com/dp/…, etc). Never invent.
- name: keep the merchant's full product title; put the cleaned title in shortName.
- If this is not an order confirmation, return {"error":"not_an_order"}.`;
}

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
  input: {
    subject: string;
    text?: string;
    merchantSlug?: string | null;
    customCategories?: readonly CategoryOption[];
  },
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
        customCategories: input.customCategories,
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
    categoryOptions: readonly CategoryOption[];
  },
): ExtractedOrder {
  const allowed = new Set(input.categoryOptions.map((c) => c.slug));
  const customCategories = input.categoryOptions.filter(
    (c) => !(CATEGORY_SLUGS as readonly string[]).includes(c.slug),
  );
  const categorized = restrictCategorySlugs(
    fillMissingCategories(attachProductLinks(order, input.html, input.text), {
      ...input,
      customCategories,
    }),
    allowed,
  );
  return {
    ...categorized,
    lines: categorized.lines.map((line) => {
      const enriched = enrichItemDisplay({
        name: line.name,
        shortName: line.shortName,
        variant: line.variant,
        categorySlug: line.categorySlug,
        searchTags: line.searchTags,
      });
      return {
        ...line,
        shortName: enriched.shortName,
        searchTags: enriched.searchTags,
      };
    }),
  };
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
  /** System + user category slugs the model may assign. */
  categoryOptions?: readonly CategoryOption[];
}): Promise<{
  result: ApplyExtractionResult;
  source: 'llm' | 'heuristic';
  /**
   * True when a structured merchant heuristic reconciled without needing the
   * LLM. Callers should not force needs_review for these.
   */
  trusted?: boolean;
  parserVersion: string;
  raw?: unknown;
}> {
  const categoryOptions =
    input.categoryOptions && input.categoryOptions.length > 0
      ? input.categoryOptions
      : defaultCategoryOptions();
  const customCategories = categoryOptions.filter(
    (c) => !(CATEGORY_SLUGS as readonly string[]).includes(c.slug),
  );
  const apiKey = input.apiKey ?? process.env.ANTHROPIC_API_KEY;

  const structuredHeuristic =
    parseAmazonQuantityLines(input.text).length > 0 ||
    parseShopifyQuantityLines(input.text).length > 0;

  // Known-good Amazon / Shopify layouts: skip Haiku when arithmetic already
  // reconciles. Cuts latency and Anthropic spend on the common path.
  if (structuredHeuristic) {
    const heuristic = heuristicExtractOrder({
      ...input,
      customCategories,
    });
    if (heuristic) {
      const applied = applyExtraction(heuristic);
      if (applied.ok) {
        return {
          result: {
            ...applied,
            order: enrichExtractedOrder(applied.order, {
              ...input,
              categoryOptions,
            }),
          },
          source: 'heuristic',
          trusted: true,
          parserVersion: PARSER_VERSION,
          raw: heuristic,
        };
      }
    }
  }

  if (apiKey) {
    try {
      const client = new Anthropic({ apiKey });
      const truncated = input.text.slice(0, 14_000);
      const message = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1800,
        system: buildSystemPrompt(categoryOptions),
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
              order: enrichExtractedOrder(result.order, {
                ...input,
                categoryOptions,
              }),
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

  const heuristic = heuristicExtractOrder({
    ...input,
    customCategories,
  });
  if (!heuristic) {
    return {
      result: { ok: false, reason: 'schema', issues: ['no_extraction'] },
      source: 'heuristic',
      trusted: false,
      parserVersion: PARSER_VERSION,
    };
  }
  const applied = applyExtraction(heuristic);
  if (!applied.ok) {
    return {
      result: applied,
      source: 'heuristic',
      trusted: false,
      parserVersion: PARSER_VERSION,
      raw: heuristic,
    };
  }
  return {
    result: {
      ...applied,
      order: enrichExtractedOrder(applied.order, {
        ...input,
        categoryOptions,
      }),
    },
    source: 'heuristic',
    trusted: false,
    parserVersion: PARSER_VERSION,
    raw: heuristic,
  };
}

export type { ExtractedOrder };
