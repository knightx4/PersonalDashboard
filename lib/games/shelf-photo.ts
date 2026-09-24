/**
 * Read a shelf photo of board game boxes.
 *
 * The job is not just "list the games" — it is to be honest about what it
 * could not read. A stack photo always has boxes at bad angles, boxes behind
 * other boxes, and spines cropped by the frame. Those come back as a count of
 * unread boxes rather than silently disappearing, so the user knows the import
 * is incomplete and by roughly how much.
 */
import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { z } from 'zod';

/** Vision over a crowded shelf is the hard part; do not skimp on the model. */
const SHELF_MODEL = 'claude-opus-5';

export const shelfSightingSchema = z.object({
  title: z.string().trim().min(1),
  publisher: z.string().trim().nullable().optional(),
  /** "Legacy Season 1", "Cities & Knights", "Mega Edition" — priced apart. */
  edition: z.string().trim().nullable().optional(),
  confidence: z.enum(['high', 'medium', 'low']),
  note: z.string().trim().nullable().optional(),
});

export const shelfReadingSchema = z.object({
  games: z.array(shelfSightingSchema).max(80),
  unreadable_boxes: z.number().int().min(0).max(200),
  notes: z.string().trim().nullable().optional(),
});

export type ShelfSighting = z.infer<typeof shelfSightingSchema>;
export type ShelfReading = z.infer<typeof shelfReadingSchema>;

const SYSTEM = `You catalogue board game collections from photos.

Report every distinct game box you can see. Rules that matter:
- Editions and expansions are separate products. "Catan", "Catan: Seafarers",
  and "Catan: Cities & Knights" are three entries, not one. So are
  "Pandemic Legacy Season 0/1/2" and "Monopoly" vs "Monopoly Mega Edition".
- Include the edition wording in the edition field, not the title.
- confidence: "high" when the box front or spine is fully legible,
  "medium" when you are inferring from partial text or box art,
  "low" when you are guessing.
- Never invent a game to fill a gap. A box you cannot identify counts toward
  unreadable_boxes instead.
- unreadable_boxes: how many boxes are visible but not identifiable (turned
  away, hidden behind others, cut off by the frame, too blurry).`;

const TOOL_NAME = 'report_shelf';

export type ShelfPhotoResult =
  | { ok: true; reading: ShelfReading }
  | { ok: false; error: string };

export async function readGameShelfPhoto(input: {
  apiKey: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  base64Data: string;
  /** What the call cost; record it as 'read-shelf-photo'. */
  onSpend?: SpendSink;
}): Promise<ShelfPhotoResult> {
  const client = new Anthropic({ apiKey: input.apiKey });

  let response;
  try {
    // A forced tool call is the reliable way to get schema-shaped JSON back.
    response = await client.messages.create({
      model: SHELF_MODEL,
      // Forty entries is ~1,500 tokens; a high ceiling only buys a slower
      // worst case, and the whole read has to fit a serverless time limit.
      max_tokens: 4096,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the board games visible in the photo.',
          input_schema: {
            type: 'object',
            properties: {
              games: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    publisher: { type: ['string', 'null'] },
                    edition: { type: ['string', 'null'] },
                    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                    note: { type: ['string', 'null'] },
                  },
                  required: ['title', 'confidence'],
                },
              },
              unreadable_boxes: { type: 'integer' },
              notes: { type: ['string', 'null'] },
            },
            required: ['games', 'unreadable_boxes'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: input.mediaType,
                data: input.base64Data,
              },
            },
            {
              type: 'text',
              text: 'Catalogue every board game box in this photo, and count the ones you cannot identify.',
            },
          ],
        },
      ],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, error: 'Claude is rate-limiting us. Try again in a minute.' };
    }
    if (error instanceof Anthropic.APIError) {
      return {
        ok: false,
        error: `The photo reader returned ${error.status ?? 'an error'}: ${error.message}`,
      };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The photo read failed.',
    };
  }
  input.onSpend?.({ model: SHELF_MODEL, usage: usageFrom(response.usage) });

  const toolUse = response.content.find(
    (block) => block.type === 'tool_use' && block.name === TOOL_NAME,
  );
  if (!toolUse || toolUse.type !== 'tool_use') {
    return { ok: false, error: 'The model did not return a shelf listing.' };
  }

  const parsed = shelfReadingSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    return { ok: false, error: 'The shelf listing came back in an unexpected shape.' };
  }
  return { ok: true, reading: parsed.data };
}
