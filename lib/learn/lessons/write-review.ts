import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { gradeWrittenAnswer, OPENING_MODEL, type WrittenGrade } from '@/lib/learn/graph/opening-probe';
import { openingQuestionSchema, toWrittenQuestion } from '@/lib/learn/graph/opening-payload';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { reviewLines, reviewPrompt, type IdeaForReview } from './review';

/**
 * Writing and marking a review question on one idea of a passed piece (plan
 * #1145). Haiku for both, as a piece's check is: one idea in, one short
 * question out, and the marking through the same grader with its own system
 * prompt.
 */

export const REVIEW_MODEL = OPENING_MODEL;
const WRITE_TOOL = 'report_question';

const WRITE_SYSTEM = `You write one short review question on an idea somebody learned a few days
or weeks ago, to see whether they still have it. They answer from memory in a
sentence or two.

ASK THEM TO USE THE IDEA. A small situation to reason about, or a "why" or
"what happens if", fits. Never ask them to recite the claim or name a term.

ANSWERABLE IN A SENTENCE OR TWO, WITHOUT LOOKING ANYTHING UP. No derivations,
no long calculations.

DO NOT PUT THE ANSWER IN THE QUESTION.

WHEN EARLIER QUESTIONS ARE LISTED, ASK A DIFFERENT ONE: a different situation
or a different consequence, not the same question reworded.

WRITE THE ANSWER YOU EXPECT, in one or two sentences. It is what a written
answer is marked against and it is shown afterwards, so it has to stand on its
own.

IF THE IDEA CANNOT CARRY A QUESTION LIKE THAT, set unusable true and write
nothing.`;

const MARK_SYSTEM = `You are marking a written answer to a review question on one idea, against
the answer expected.

MARK THE REASONING, NOT THE WORDING. The answer is typed from memory in a
sentence or two. Different words, a rough phrasing, a missing term: all right,
if what they said reaches the point the expected answer reaches.

WRONG MEANS WRONG. Right direction with the wrong mechanism is wrong.
Restating the question is wrong. Being close is wrong: a miss only brings the
idea back sooner, so there is no cost to them in marking it honestly.

In why, speak to them in one or two plain sentences. When the answer is right,
say what it got right. When it is wrong, say what it was missing or got wrong.
Then set correct.`;

export type WrittenReview =
  | { outcome: 'ready'; question: string; expected: string }
  | { outcome: 'dropped'; reason: string }
  | { outcome: 'failed'; detail: string };

/** Write one review question on an idea, different from those in `asked`. Never throws. */
export async function writeReviewQuestion(input: {
  idea: IdeaForReview;
  asked: readonly string[];
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<WrittenReview> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  let response;
  try {
    response = await client.messages.create({
      model: REVIEW_MODEL,
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
      messages: [{ role: 'user', content: reviewPrompt(input.idea, input.asked, WRITE_TOOL) }],
    });
  } catch (error) {
    return { outcome: 'failed', detail: error instanceof Error ? error.message : 'Writing the question failed.' };
  }

  input.onSpend?.({ model: REVIEW_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === WRITE_TOOL);
  if (!block || block.type !== 'tool_use') return { outcome: 'failed', detail: whyNoReport(response) };

  const safe = openingQuestionSchema.safeParse(block.input);
  if (!safe.success) return { outcome: 'failed', detail: 'The question came back malformed.' };

  const checked = toWrittenQuestion(safe.data);
  if (!checked.ok) return { outcome: 'dropped', reason: checked.reason };
  return { outcome: 'ready', question: checked.question.question, expected: checked.question.expected };
}

/** Mark one answer to a review question. Never throws. */
export function markReviewQuestion(input: {
  idea: IdeaForReview;
  question: string;
  expected: string;
  response: string;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<WrittenGrade> {
  return gradeWrittenAnswer({
    system: MARK_SYSTEM,
    context: reviewLines(input.idea),
    question: input.question,
    expected: input.expected,
    response: input.response,
    anthropicApiKey: input.anthropicApiKey,
    client: input.client,
    onSpend: input.onSpend,
  });
}
