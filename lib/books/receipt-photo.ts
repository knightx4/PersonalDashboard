/**
 * Receipt photo → ExtractedOrder via vision, then reuse the email apply gate.
 */
import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { applyExtraction, type ApplyExtractionResult } from '@/lib/email/extract/apply';
import {
  type CategoryOption,
  PARSER_VERSION,
} from '@/lib/email/extract/schema';
import { parseImageDataUrl } from '@/lib/images/data-url';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';

const RECEIPT_MODEL = 'claude-haiku-4-5-20251001';

export async function extractOrderFromReceiptPhoto(input: {
  imageDataUrl: string;
  apiKey: string;
  categories?: readonly CategoryOption[];
  /** What the call cost; record it as 'read-receipt-photo'. */
  onSpend?: SpendSink;
}): Promise<ApplyExtractionResult> {
  const parsedImage = parseImageDataUrl(input.imageDataUrl);
  if (!parsedImage.ok) {
    return { ok: false, reason: 'schema', issues: [parsedImage.error] };
  }

  const client = new Anthropic({ apiKey: input.apiKey });
  const slugList =
    (input.categories ?? []).map((c) => c.slug).join(', ') ||
    'clothing, electronics, home, kitchen, beauty, health, groceries, hobby, pet, books, other';

  const response = await client.messages.create({
    model: RECEIPT_MODEL,
    max_tokens: 2048,
    system: `You extract a purchase receipt into structured JSON matching this shape:
{
  "merchantName": string|null,
  "merchantSlug": string|null,
  "externalOrderNumber": string|null,
  "orderDate": "YYYY-MM-DD",
  "currency": "USD",
  "taxCents": int,
  "shippingCents": int,
  "discountCents": int,
  "totalCents": int,
  "lines": [{"name": string, "shortName": string, "variant": string|null, "quantity": int, "unitPriceCents": int, "categorySlug": string|null, "productUrl": null, "imageUrl": null, "searchTags": [], "tags": []}],
  "confidence": 0-1
}
categorySlug must be one of: ${slugList}.
Money is integer cents. quantity * unitPrice + tax + shipping - discount must equal totalCents (±2 cents).
Parser: ${PARSER_VERSION}. Return ONLY JSON.`,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: parsedImage.mediaType,
              data: parsedImage.data,
            },
          },
          { type: 'text', text: 'Extract the order from this receipt photo.' },
        ],
      },
    ],
  });

  input.onSpend?.({ model: RECEIPT_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'text');
  if (!block || block.type !== 'text') {
    return { ok: false, reason: 'schema', issues: ['Model returned no text.'] };
  }

  const jsonMatch = block.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { ok: false, reason: 'schema', issues: ['Could not parse receipt JSON.'] };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(jsonMatch[0]);
  } catch {
    return { ok: false, reason: 'schema', issues: ['Invalid receipt JSON.'] };
  }

  return applyExtraction(raw);
}
