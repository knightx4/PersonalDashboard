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

function parseDataUrl(dataUrl: string): { mediaType: string; data: string } | null {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return null;
  return { mediaType: match[1]!, data: match[2]!.replace(/\s+/g, '') };
}

export async function extractOrderFromReceiptPhoto(input: {
  imageDataUrl: string;
  apiKey: string;
  categories?: readonly CategoryOption[];
}): Promise<ApplyExtractionResult> {
  const parsedImage = parseDataUrl(input.imageDataUrl);
  if (!parsedImage) {
    return {
      ok: false,
      reason: 'schema',
      issues: ['Upload a JPEG or PNG receipt photo.'],
    };
  }

  const client = new Anthropic({ apiKey: input.apiKey });
  const slugList =
    (input.categories ?? []).map((c) => c.slug).join(', ') ||
    'clothing, electronics, home, kitchen, beauty, health, groceries, hobby, pet, books, other';

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
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
              media_type: parsedImage.mediaType as
                | 'image/jpeg'
                | 'image/png'
                | 'image/gif'
                | 'image/webp',
              data: parsedImage.data,
            },
          },
          { type: 'text', text: 'Extract the order from this receipt photo.' },
        ],
      },
    ],
  });

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
