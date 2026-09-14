import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import type { SpendSink } from '@/lib/core/spend/pricing';
import { gradeWrittenAnswer, type WrittenGrade } from '@/lib/learn/graph/opening-probe';

/**
 * Marking what you wrote against what the material said.
 *
 * The same call the opening sweep grades with -- one model, one tool, one
 * schema, never throws -- with a prompt written for this screen. The
 * difference that matters is where the right answer came from: a sweep grades
 * against a claim about a subject, and a quiz grades against a sentence out of
 * your own notes, so "that is not what this material says" is the judgement
 * being asked for rather than "that is not true".
 */

const QUIZ_GRADE_SYSTEM = `You are grading a written answer against the answer the material expects.

GRADE THE IDEA, NOT THE WORDING. The answer is typed from memory. Different
words, a rough phrasing, a missing term: all right, if what they said is the
thing the expected answer says.

GRADE AGAINST THE MATERIAL, NOT THE WORLD. The expected answer came out of what
they chose to be quizzed on. An answer that is true in general but is not what
this material says is wrong here.

WRONG MEANS WRONG. Right direction with the wrong mechanism is wrong. Restating
the question is wrong. Saying nothing in more words is wrong. Being close is
wrong.

Write your reasoning in one sentence first, then set correct.`;

export async function gradeQuizAnswer(input: {
  /** What the question came from, so the grader knows where it is standing. */
  source: string;
  question: string;
  expected: string;
  response: string;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<WrittenGrade> {
  return gradeWrittenAnswer({
    ...input,
    system: QUIZ_GRADE_SYSTEM,
    context: [`The material this came from: ${input.source}`],
  });
}
