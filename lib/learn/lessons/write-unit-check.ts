import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { gradeWrittenAnswer, OPENING_MODEL, type WrittenGrade } from '@/lib/learn/graph/opening-probe';
import { openingQuestionSchema, toWrittenQuestion } from '@/lib/learn/graph/opening-payload';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { CHECK_CONCEPTS_NAMED } from './unit-check';

/**
 * Writing and marking a unit check (LEARN-LESSONS-SPEC, "The unit check";
 * plan #971).
 *
 * The top-up writes one question for a unit that is done, needing its
 * concepts together and answered in a sentence or two, with the answer it
 * expects. Pressing Check my answer marks what was written against the unit's
 * outcome. Haiku for both: one unit in, one short thing out, as the opening
 * sweep's questions are, and the marking goes through the same grader
 * (`gradeWrittenAnswer`) with its own system prompt.
 */

export const UNIT_CHECK_MODEL = OPENING_MODEL;
const WRITE_TOOL = 'report_question';

export type UnitForCheck = {
  trackName: string;
  title: string;
  covers: string | null;
  outcome: string | null;
  concepts: readonly { name: string; claim: string }[];
};

const WRITE_SYSTEM = `You write one question checking that somebody can use a unit of a subject they
have just finished, to be answered from memory in a sentence or two.

THE QUESTION NEEDS SEVERAL OF THE UNIT'S IDEAS TOGETHER. A question one idea
answers alone checks that idea, not the unit. A short situation to reason
about, or a "why" that crosses two or three of the ideas, is what fits.

AIM AT THE UNIT'S OUTCOME. It says what somebody who finished the unit can do;
the question asks them to do it once.

ANSWERABLE IN A SENTENCE OR TWO, WITHOUT LOOKING ANYTHING UP. No derivations,
no numbers to compute, nothing that needs a source open.

ASK WHAT FOLLOWS, NOT WHAT IT IS CALLED. Never ask for a term.

DO NOT PUT THE ANSWER IN THE QUESTION.

WRITE THE ANSWER YOU EXPECT, in one or two sentences. It is what a written
answer is marked against and it is shown afterwards, so it has to stand on its
own.

IF THE UNIT CANNOT CARRY A QUESTION LIKE THAT, set unusable true and write
nothing.`;

const MARK_SYSTEM = `You are marking a written answer to a question that checks a whole unit of a
subject, against the unit's outcome and the answer expected.

MARK THE REASONING, NOT THE WORDING. The answer is typed from memory in a
sentence or two. Different words, a rough phrasing, a missing term: all right,
if what they said reaches the outcome the way the expected answer does.

WRONG MEANS WRONG. Right direction with the wrong mechanism is wrong. Using one
idea where the question needs several is wrong. Restating the question is
wrong. Being close is wrong: a right answer marks every idea in the unit as
tested.

Write your reasoning in one sentence first, then set correct.`;

/** The lines about the unit both calls are given. */
function unitLines(unit: UnitForCheck): string[] {
  const concepts = unit.concepts.slice(0, CHECK_CONCEPTS_NAMED);
  return [
    `Track: ${unit.trackName}`,
    `Unit: ${unit.title}`,
    ...(unit.covers?.trim() ? [`What it covers: ${unit.covers.trim()}`] : []),
    ...(unit.outcome?.trim() ? [`Its outcome: ${unit.outcome.trim()}`] : []),
    '',
    'The ideas in it:',
    ...concepts.map((concept) => `- ${concept.name}: ${concept.claim}`),
  ];
}

export type WrittenUnitCheck =
  | { outcome: 'ready'; question: string; expected: string }
  | { outcome: 'dropped'; reason: string }
  | { outcome: 'failed'; detail: string };

/** Write the check for one unit. Never throws. */
export async function writeUnitCheck(input: {
  unit: UnitForCheck;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<WrittenUnitCheck> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  let response;
  try {
    response = await client.messages.create({
      model: UNIT_CHECK_MODEL,
      max_tokens: 1024,
      system: WRITE_SYSTEM,
      tools: [
        {
          name: WRITE_TOOL,
          description: 'Report the question and the answer it expects.',
          input_schema: {
            type: 'object',
            properties: {
              question: { type: 'string' },
              expected: { type: 'string' },
              unusable: { type: 'boolean' },
            },
            required: ['question', 'expected'],
          },
        },
      ],
      tool_choice: forceTool(WRITE_TOOL),
      messages: [{ role: 'user', content: [...unitLines(input.unit), '', `Call ${WRITE_TOOL}.`].join('\n') }],
    });
  } catch (error) {
    return { outcome: 'failed', detail: error instanceof Error ? error.message : 'Writing the check failed.' };
  }

  input.onSpend?.({ model: UNIT_CHECK_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === WRITE_TOOL);
  if (!block || block.type !== 'tool_use') return { outcome: 'failed', detail: whyNoReport(response) };

  const safe = openingQuestionSchema.safeParse(block.input);
  if (!safe.success) return { outcome: 'failed', detail: 'The check came back malformed.' };

  const checked = toWrittenQuestion(safe.data);
  if (!checked.ok) return { outcome: 'dropped', reason: checked.reason };
  return { outcome: 'ready', question: checked.question.question, expected: checked.question.expected };
}

/** Mark one answer to a unit check against the unit's outcome. Never throws. */
export function markUnitCheck(input: {
  unit: UnitForCheck;
  question: string;
  expected: string;
  response: string;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<WrittenGrade> {
  return gradeWrittenAnswer({
    system: MARK_SYSTEM,
    context: unitLines(input.unit),
    question: input.question,
    expected: input.expected,
    response: input.response,
    anthropicApiKey: input.anthropicApiKey,
    client: input.client,
    onSpend: input.onSpend,
  });
}
