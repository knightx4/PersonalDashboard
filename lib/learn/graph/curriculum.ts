import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { readCurriculum, MAX_UNITS, MIN_UNITS, type CurriculumResult } from './curriculum-payload';

/**
 * Writing a track's curriculum, once, when the track is made
 * (LEARN-GRAPH-SPEC, "The curriculum").
 *
 * One call. The model is given the track's name and what the person asked
 * for when they started it, and lays out the units a well-taught course on the
 * subject would cover, in the order they would be taught. The list is fixed
 * after this: nothing regenerates it, and the detail inside each unit comes
 * later, when the person opens it and its chain of ideas is laid out.
 *
 * It also says which unit the person's own first question belongs to, so the
 * chain approved alongside it is filed under that unit.
 *
 * Sonnet, for the reason the chain generator gives: this is laying out what
 * everybody who teaches the subject already agrees on.
 */

export const CURRICULUM_MODEL = 'claude-sonnet-5';

const TOOL_NAME = 'report_curriculum';

const SYSTEM = `You write the curriculum for one track of study, once, at the moment the track is made. It is fixed after this, so it has to be the right shape from the start.

You are given the track's name and what the person asked for when they started it. Lay out the units a well-taught course on this subject covers, in the order they should be learned.

- ${MIN_UNITS} to ${MAX_UNITS} units. Enough to cover the subject properly, few enough that each is a real block of study, roughly a week of evenings.
- In teaching order: a unit only depends on units before it.
- Cover the whole subject, including the parts past the introduction: the standard models, the evidence, how it is applied, and where it is contested. The person is an adult who already knows the everyday meaning of the basic terms, so there is no "What is X" unit.
- Each unit is specific: "Price elasticity and tax incidence", not "Key concepts".
- title: under 60 characters.
- covers: one or two sentences naming the ideas the unit teaches.
- outcome: one sentence saying what the person can do once they have learned it, starting with a verb ("Predict who bears a tax from the elasticities on each side").
- goal_unit: the number of the unit the person's own question falls in, counting from 1.

Plain sentences. No slogans, no "not X, but Y" contrasts, no dashes used for rhythm.

Report through ${TOOL_NAME}.`;

export async function writeCurriculum(input: {
  subject: string;
  /** What the person typed when the track was started, when there was something. */
  asked: string | null;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<CurriculumResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  let response;
  try {
    response = await client.messages.create({
      model: CURRICULUM_MODEL,
      max_tokens: 3000,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the units of the curriculum, in teaching order.',
          input_schema: {
            type: 'object',
            properties: {
              units: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    covers: { type: 'string' },
                    outcome: { type: 'string' },
                  },
                  required: ['title', 'covers', 'outcome'],
                },
              },
              goal_unit: { type: ['integer', 'null'] },
            },
            required: ['units', 'goal_unit'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME),
      messages: [
        {
          role: 'user',
          content: [
            `The track: ${input.subject}`,
            input.asked
              ? `What they asked for when they started it: ${input.asked}`
              : 'They did not say more than the name.',
            '',
            `Call ${TOOL_NAME}.`,
          ].join('\n'),
        },
      ],
    });
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : 'The curriculum call failed.',
    };
  }

  // Before the reply is read: a malformed report still cost what it cost.
  input.onSpend?.({ model: CURRICULUM_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find(
    (part) => part.type === 'tool_use' && part.name === TOOL_NAME,
  );
  if (!block || block.type !== 'tool_use') return { ok: false, detail: whyNoReport(response) };
  return readCurriculum(block.input);
}
