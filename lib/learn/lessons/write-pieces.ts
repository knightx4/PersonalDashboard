import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { CURRICULUM_MODEL } from '@/lib/learn/graph/curriculum';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { PIECES_MAX, piecesPrompt, readPieces, type PieceIdea, type PiecesResult } from './pieces-payload';

/**
 * Splitting one laid-out unit into pieces (plan #1140). One call per unit.
 *
 * Sonnet, the model that writes the outline and the unit's chain: grouping
 * ideas into sittings is part of laying the course out, and a unit's pieces
 * are written once.
 */

export const PIECES_MODEL = CURRICULUM_MODEL;

const TOOL_NAME = 'report_pieces';

const SYSTEM = `You split one unit of a course into pieces. A piece is one sitting of about 20 to 30 minutes: a few short lessons on its ideas, a practice task, and a question that checks them together. The person works through the pieces in the order you give, though they may open any piece at any time.

You are given the unit, what it covers and its outcome, and its ideas, numbered, in an order where each comes after the ideas it builds on.

- Every idea goes in exactly one piece. Name each by its number.
- Group ideas that are taught well together: an idea with what it builds on, or two ideas best understood side by side. A piece usually holds two to four ideas.
- Order the pieces so a piece comes after the pieces holding what its ideas build on. Within a piece, list ideas in teaching order.
- title: under 60 characters, specific to what the piece teaches ("Reading a cohort retention grid", not "Part 2").

Plain sentences. No slogans, no "not X, but Y" contrasts, no dashes used for rhythm.

Report through ${TOOL_NAME}.`;

export async function writePieces(input: {
  trackName: string;
  unit: { title: string; covers: string | null; outcome: string | null };
  ideas: readonly PieceIdea[];
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<PiecesResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  let response;
  try {
    response = await client.messages.create({
      model: PIECES_MODEL,
      max_tokens: 1500,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the unit\'s pieces, in the order they are suggested.',
          input_schema: {
            type: 'object',
            properties: {
              pieces: {
                type: 'array',
                maxItems: PIECES_MAX,
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    ideas: { type: 'array', items: { type: 'integer' } },
                  },
                  required: ['title', 'ideas'],
                },
              },
            },
            required: ['pieces'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME),
      messages: [{ role: 'user', content: piecesPrompt(input) }],
    });
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'The pieces call failed.' };
  }

  // Before the reply is read: a malformed report still cost what it cost.
  input.onSpend?.({ model: PIECES_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') return { ok: false, detail: whyNoReport(response) };
  return readPieces(block.input, input.ideas.length);
}
