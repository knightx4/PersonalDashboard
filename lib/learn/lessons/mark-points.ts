import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { OPENING_MODEL } from '@/lib/learn/graph/opening-probe';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { markPointsPrompt, pointMarksSchema, toPointMarks, type HandIn, type PointMark } from './point-marks';

/**
 * The Haiku call that marks handed-in work point by point (plan #1142), as
 * teach-backs and checks are marked: one short piece of work in, a mark for
 * each point out. A piece's practice is its first user; anything else marked
 * against a list of points (the plan's final project) calls this with its own
 * context and, where the defaults do not fit, its own system prompt.
 */

export const MARK_POINTS_MODEL = OPENING_MODEL;
const TOOL = 'report_marks';

export const MARK_POINTS_SYSTEM = `You mark a piece of work somebody handed in, point by point, against the
points the task said a complete hand-in has. They typed it into a page: figures
by name, and their working as text.

FOR EACH POINT, SAY WHETHER THE HAND-IN MEETS IT. A figure meets its point when
it matches the expected value within the tolerance the point gives, or within
ordinary rounding when it gives none. Working that reaches the point in other
words meets it; rough phrasing and missing terms are fine. A point the hand-in
does not address is not met. A wrong figure is not met, even when the method
behind it was right.

JUDGE ONLY WHAT WAS HANDED IN. Do not credit a point because the rest of the
work suggests they could have made it.

IN EACH NOTE, SPEAK TO THEM IN ONE PLAIN SENTENCE. For a point met, say what
they got right. For a point not met, say what is missing or wrong and what to
look at again, without giving the expected figure or the answer away: they
will try again.

Mark every point, by its number.`;

export type MarkedPoints = { ok: true; marks: PointMark[]; passed: boolean } | { ok: false; detail: string };

/** Mark one hand-in against its points. Never throws. */
export async function markAgainstPoints(input: {
  context: readonly string[];
  task: string;
  points: readonly string[];
  /** A worked answer the marker reads and the person has not seen. */
  reference: string;
  handIn: HandIn;
  system?: string;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<MarkedPoints> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  let response;
  try {
    response = await client.messages.create({
      model: MARK_POINTS_MODEL,
      max_tokens: 1024,
      system: input.system ?? MARK_POINTS_SYSTEM,
      tools: [
        {
          name: TOOL,
          description: 'Report a mark for every point, by its number.',
          input_schema: {
            type: 'object',
            properties: {
              marks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    number: { type: 'integer' },
                    met: { type: 'boolean' },
                    note: { type: 'string' },
                  },
                  required: ['number', 'met', 'note'],
                },
              },
            },
            required: ['marks'],
          },
        },
      ],
      tool_choice: forceTool(TOOL, MARK_POINTS_MODEL),
      messages: [
        {
          role: 'user',
          content: markPointsPrompt({
            context: input.context,
            task: input.task,
            points: input.points,
            reference: input.reference,
            handIn: input.handIn,
            tool: TOOL,
          }),
        },
      ],
    });
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'Marking failed.' };
  }

  input.onSpend?.({ model: MARK_POINTS_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === TOOL);
  if (!block || block.type !== 'tool_use') return { ok: false, detail: whyNoReport(response) };

  const safe = pointMarksSchema.safeParse(block.input);
  if (!safe.success) return { ok: false, detail: 'The marks came back malformed.' };

  const lined = toPointMarks(input.points, safe.data);
  return lined.ok ? lined : { ok: false, detail: lined.reason };
}
