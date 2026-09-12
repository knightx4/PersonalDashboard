import { MASTERY_MAX, MASTERY_MIN } from '@/lib/learn/graph/chain-payload';

/**
 * What every path that proposes a concept says about its checks.
 *
 * Five calls write concepts -- a typed goal, a pasted briefing, a note written
 * after reading, prior knowledge somebody declared, and the floor offered under
 * a claim they missed -- and each has its own prompt and its own tool schema.
 * The rule about what a check is has to be the same in all five, because a
 * question is later written against one of them and a check that is really a
 * restatement of the claim produces a question that tests nothing. One
 * paragraph in one place is what keeps the five honest with each other.
 */
export const MASTERY_RULE = `WHAT UNDERSTANDING IT LOOKS LIKE. Every node carries two to four short checks,
each one something a person could be asked to do with the claim rather than a
restatement of it. What it rules out, how it applies to a case with the numbers
changed, what the standard objection to it is. A question will later be written
against one of these, so a check that cannot be turned into a question is not a
check.

  Claim: "Wages adjust more slowly than prices, so a burst of inflation raises
  employment until expectations catch up."
  Checks: "Says what happens to employment when the inflation is expected in
  advance." / "Explains why the effect is not there in the long run." / "Answers
  the objection that workers can simply ask for more."`;

/** The same field in every `report_chain` tool schema. */
export const MASTERY_TOOL_FIELD = {
  type: 'array',
  items: { type: 'string' },
  minItems: MASTERY_MIN,
  maxItems: MASTERY_MAX,
} as const;
