import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import type { SpendSink } from '@/lib/core/spend/pricing';
import { gradeWrittenAnswer } from '@/lib/learn/graph/opening-probe';

/**
 * Reading the reasoning given with a right multiple-choice pick (plan
 * #2522.3). A picked answer has no grader of its own, so when reasoning comes
 * with a right pick this is the call that reads it: one Haiku call through the
 * same written-answer grader, told the pick was right and asked only whether
 * the reasoning holds. A wrong pick, or a pick with no reasoning, never calls it.
 */

export const CHECK_REASONING_SYSTEM = `Somebody picked the right option in a multiple-choice question and wrote a
line or two on why. You read that reasoning, not the pick.

correct is true when the reasoning is consistent with the right answer: it
reaches the option by a sound idea, however roughly it is put. Short,
incomplete or informal reasoning is fine.

correct is false when the reasoning contradicts the answer, argues for a
different option, or reaches the right option by an idea that is wrong. A
right pick for a wrong reason is a wrong answer.

In why, speak to them in one plain sentence. When it holds, say what it got
right. When it does not, name the part of the reasoning that does not hold.`;

export type ReasoningCheck = { ok: true; holds: boolean; why: string } | { ok: false; detail: string };

/** Whether the reasoning behind a right pick holds. Never throws. */
export async function checkPickedReasoning(input: {
  concept: string;
  claim: string;
  question: string;
  /** The option picked, which is the right one. */
  picked: string;
  /** Why that option is right, as the question was written with it. */
  reason: string;
  reasoning: string;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<ReasoningCheck> {
  const grade = await gradeWrittenAnswer({
    system: CHECK_REASONING_SYSTEM,
    context: [`Concept: ${input.concept}`, `The claim: ${input.claim}`],
    question: input.question,
    expected: `${input.picked} (the option they picked). Why it is right: ${input.reason}`,
    response: `Their reasoning for picking it: ${input.reasoning}`,
    anthropicApiKey: input.anthropicApiKey,
    client: input.client,
    onSpend: input.onSpend,
  });
  return grade.ok ? { ok: true, holds: grade.correct, why: grade.why } : grade;
}
