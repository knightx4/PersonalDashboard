import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '@/lib/core/models';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { PIECE_CELLS_MAX, pieceCellsPrompt, readPieceCells, type PieceToMatch, type TerritoryCell } from './piece-cells';

/**
 * Naming the cells each piece of a unit teaches (plan #2138.13). One call per
 * unit, when its pieces are written and again for pieces written before their
 * goal had a territory.
 *
 * Haiku: the pieces and the cells both come in written out, and the call only
 * matches one short list against another.
 */

export const PIECE_CELLS_MODEL = MODELS.learnPieceCells;
const TOOL = 'report_piece_cells';

const SYSTEM = `You match the pieces of one unit of a course to the levels of understanding they teach.

Each piece is a sitting of about half an hour that teaches a few ideas. Each
level is a topic at a level from 1 to 10, with checks saying what meeting it
looks like.

A PIECE TEACHES A LEVEL when somebody who has worked through its ideas could
meet that level's checks, or most of the way. Naming the same topic is not
enough: the ideas must teach what the checks ask for.

- Give each piece the levels it teaches, at most ${PIECE_CELLS_MAX}, by key (C1, C2, ...).
- Prefer the highest level of a topic the piece reaches over the levels below
  it; the ones below are implied.
- A piece that teaches none of the levels gets an empty list. That is better
  than a weak match.
- A level may go on more than one piece.

Call ${TOOL} once, with one entry per piece, naming the piece by its number.`;

export type MatchedPieceCells = { ok: true; cells: string[][] } | { ok: false; detail: string };

/** The cell ids each piece names, in piece order. Never throws. */
export async function matchPieceCells(input: {
  trackName: string;
  unitTitle: string;
  pieces: readonly PieceToMatch[];
  cells: readonly TerritoryCell[];
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<MatchedPieceCells> {
  if (input.pieces.length === 0 || input.cells.length === 0) {
    return { ok: true, cells: input.pieces.map(() => []) };
  }
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  let response;
  try {
    response = await client.messages.create({
      model: PIECE_CELLS_MODEL,
      max_tokens: 1200,
      system: SYSTEM,
      tools: [
        {
          name: TOOL,
          description: 'Report the levels each piece teaches.',
          input_schema: {
            type: 'object',
            properties: {
              pieces: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    piece: { type: 'integer' },
                    cells: { type: 'array', items: { type: 'string' } },
                  },
                  required: ['piece', 'cells'],
                },
              },
            },
            required: ['pieces'],
          },
        },
      ],
      tool_choice: forceTool(TOOL, PIECE_CELLS_MODEL),
      messages: [{ role: 'user', content: pieceCellsPrompt({ ...input, tool: TOOL }) }],
    });
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'Matching the pieces to levels failed.' };
  }
  input.onSpend?.({ model: PIECE_CELLS_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === TOOL);
  if (!block || block.type !== 'tool_use') return { ok: false, detail: whyNoReport(response) };
  const cells = readPieceCells(block.input, input.pieces.length, input.cells);
  if (!cells) return { ok: false, detail: 'The levels for the pieces came back malformed.' };
  return { ok: true, cells };
}
