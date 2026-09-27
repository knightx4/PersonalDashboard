import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { gradeWrittenAnswer, OPENING_MODEL, type WrittenGrade } from '@/lib/learn/graph/opening-probe';
import { openingQuestionSchema, toWrittenQuestion } from '@/lib/learn/graph/opening-payload';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { pieceCheckPrompt, pieceLines, type PieceForCheck } from './piece-check';

/**
 * Writing and marking a piece's check (plan #1141). Haiku for both, as the
 * unit check is: one piece in, one short thing out. The marking goes through
 * the same grader (`gradeWrittenAnswer`) with its own system prompt, which
 * asks for what a wrong answer was missing, since that sentence is what the
 * page shows before offering another question.
 */

export const PIECE_CHECK_MODEL = OPENING_MODEL;
const WRITE_TOOL = 'report_question';

const WRITE_SYSTEM = `You write one question checking that somebody can use what one piece of a
course taught them. They have just read its lessons, and answer from memory in
a sentence or two.

THE QUESTION NEEDS THE PIECE'S IDEAS TOGETHER. A question one idea answers
alone checks that idea, not the piece. A short situation to reason about, or a
"why" that crosses two or three of the ideas, is what fits. A piece with one
idea gets a question applying that idea to a situation.

ANSWERABLE IN A SENTENCE OR TWO, WITHOUT LOOKING ANYTHING UP. No derivations,
no long calculations, nothing that needs a source open.

ASK WHAT FOLLOWS, NOT WHAT IT IS CALLED. Never ask for a term.

DO NOT PUT THE ANSWER IN THE QUESTION.

WHEN EARLIER QUESTIONS ARE LISTED, ASK A DIFFERENT ONE: a different situation
or a different link between the ideas, not the same question reworded.

WRITE THE ANSWER YOU EXPECT, in one or two sentences. It is what a written
answer is marked against and it is shown afterwards, so it has to stand on its
own.

IF THE PIECE CANNOT CARRY A QUESTION LIKE THAT, set unusable true and write
nothing.`;

const MARK_SYSTEM = `You are marking a written answer to a question that checks one piece of a
course, against the answer expected.

MARK THE REASONING, NOT THE WORDING. The answer is typed from memory in a
sentence or two. Different words, a rough phrasing, a missing term: all right,
if what they said reaches the point the expected answer reaches.

WRONG MEANS WRONG. Right direction with the wrong mechanism is wrong. Using one
idea where the question needs several is wrong. Restating the question is
wrong. Being close is wrong: a right answer passes the piece and marks every
idea in it as tested.

In why, speak to them in one or two plain sentences. When the answer is right,
say what it got right. When it is wrong, say what it was missing or got wrong,
naming the idea it needed, so they know what to reread. Then set correct.`;

export type WrittenPieceCheck =
  | { outcome: 'ready'; question: string; expected: string }
  | { outcome: 'dropped'; reason: string }
  | { outcome: 'failed'; detail: string };

/** Write one question for a piece, different from those in `asked`. Never throws. */
export async function writePieceCheck(input: {
  piece: PieceForCheck;
  asked: readonly string[];
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<WrittenPieceCheck> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  let response;
  try {
    response = await client.messages.create({
      model: PIECE_CHECK_MODEL,
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
      messages: [{ role: 'user', content: pieceCheckPrompt(input.piece, input.asked, WRITE_TOOL) }],
    });
  } catch (error) {
    return { outcome: 'failed', detail: error instanceof Error ? error.message : 'Writing the question failed.' };
  }

  input.onSpend?.({ model: PIECE_CHECK_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === WRITE_TOOL);
  if (!block || block.type !== 'tool_use') return { outcome: 'failed', detail: whyNoReport(response) };

  const safe = openingQuestionSchema.safeParse(block.input);
  if (!safe.success) return { outcome: 'failed', detail: 'The question came back malformed.' };

  const checked = toWrittenQuestion(safe.data);
  if (!checked.ok) return { outcome: 'dropped', reason: checked.reason };
  return { outcome: 'ready', question: checked.question.question, expected: checked.question.expected };
}

/** Mark one answer to a piece's check. Never throws. */
export function markPieceCheck(input: {
  piece: PieceForCheck;
  question: string;
  expected: string;
  response: string;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<WrittenGrade> {
  return gradeWrittenAnswer({
    system: MARK_SYSTEM,
    context: pieceLines(input.piece),
    question: input.question,
    expected: input.expected,
    response: input.response,
    anthropicApiKey: input.anthropicApiKey,
    client: input.client,
    onSpend: input.onSpend,
  });
}
