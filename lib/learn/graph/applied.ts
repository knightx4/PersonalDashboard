import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import {
  appliedPayloadSchema,
  toAppliedCase,
  type AppliedCase,
} from '@/lib/learn/graph/applied-payload';
import { gradeWrittenAnswer, type WrittenGrade } from '@/lib/learn/graph/opening-probe';

/**
 * The second rung of #386: a situation somebody has not seen, answered in
 * their own words, and the grading of what they wrote.
 *
 * Two calls where the multiple-choice rung is one, which is what makes an
 * applied case cost about twice a probe. Haiku for both, the same as the probe
 * writer and the opening sweep: one claim in, one tightly constrained thing
 * out, no judgment about a field and nothing to search.
 *
 * Right or wrong and nothing between, which is the rule the opening sweep
 * already grades by. Half credit would call a concept known off a near miss,
 * and a concept marked known is one the views stop showing you.
 *
 * Every call is independent and all the state is in Postgres, the same as
 * writeProbe: what goes in is the claim, the check the case is aimed at, and
 * the situations already used, and nothing else.
 */

/** Stored on every applied row, so what asked it is recorded with it. */
export const APPLIED_MODEL = 'claude-haiku-4-5';
const WRITE_TOOL = 'report_case';

const WRITE_SYSTEM = `You write one short case testing whether somebody can use one specific claim,
answered in a sentence or two of their own words.

INVENT A SITUATION THE CLAIM DOES NOT ALREADY DESCRIBE. Two or three sentences
of concrete circumstances -- a particular firm, a particular measurement, a
particular year -- and then ask what follows. A situation built out of the words
of the claim is the claim asked back, and somebody can answer that from memory
without using it.

ANSWERABLE IN A SENTENCE OR TWO, FROM MEMORY. No derivations, no numbers to
compute, nothing that needs a source open. The work is seeing which way the idea
points in this situation, not arithmetic.

DO NOT PUT THE ANSWER IN THE CASE. Neither the situation nor the question may
contain the answer. A case somebody can answer by reading it back measures
nothing.

ASK WHAT FOLLOWS, NOT WHAT IT IS CALLED. Never ask for a term. Somebody who
cannot produce the word and can say what happens can use the idea.

WRITE THE ANSWER YOU EXPECT, in one or two sentences, in terms of the idea. It
is what a typed answer is graded against and it is shown afterwards, so it has
to stand on its own without the situation beside it.

AIM AT THE CHECK YOU ARE GIVEN. When the prompt names one check of
understanding, the case tests that check and nothing else.

IF THE CLAIM CANNOT CARRY A CASE -- it is too vague to be right or wrong about,
or it is a definition and nothing else -- set unusable true and write nothing.`;

const GRADE_SYSTEM = `You are grading a written answer to a case, against the answer that was
expected.

GRADE THE IDEA, NOT THE WORDING. The answer is typed from memory. Different
words, a rough phrasing, a missing term: all right, if what they said is what
follows in the situation they were given.

WRONG MEANS WRONG. The right direction with the wrong mechanism is wrong.
Restating the case is wrong. Restating the claim without applying it to the
situation is wrong -- the case is there to be used, and the claim said back is
the rung below this one. Being close is wrong: half credit here would call a
concept known off a near miss.

Write your reasoning in one sentence first, then set correct.`;

export type AppliedCaseResult =
  | { ok: true; case: AppliedCase }
  | { ok: false; reason: 'unusable' | 'rejected' | 'error'; detail: string };

function buildPrompt(input: {
  concept: string;
  claim: string;
  check: string | null;
  asked: string[];
}): string {
  const lines = [`Concept: ${input.concept}`];

  // Above the claim, because it is what the case is for. #391 settled that one
  // idea gets one applied case, aimed at the check the multiple-choice answers
  // left weakest, so there is one check here rather than a list.
  if (input.check) {
    lines.push('', `Write the case against this check of understanding: ${input.check}`);
  }

  lines.push('', `The claim: ${input.claim}`);

  if (input.asked.length > 0) {
    lines.push('', 'Situations already used for this claim — invent a different one:');
    for (const situation of input.asked) lines.push(`- ${situation}`);
  }

  lines.push('', `Call ${WRITE_TOOL}.`);
  return lines.join('\n');
}

/**
 * Write one applied case. Never throws.
 *
 * A claim that cannot carry a case and a case that did not survive its own
 * check come back as different things, the same split writeProbe makes: the
 * first is a problem with the graph and wants the claim rewritten, the second
 * is a reason to ask for another.
 */
export async function writeAppliedCase(input: {
  concept: string;
  claim: string;
  /** The check this case is for, chosen by the picker. */
  check?: string | null;
  /** Situations already used for this claim, so it does not repeat itself. */
  asked?: string[];
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<AppliedCaseResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  let response;
  try {
    response = await client.messages.create({
      model: APPLIED_MODEL,
      max_tokens: 1024,
      system: WRITE_SYSTEM,
      tools: [
        {
          name: WRITE_TOOL,
          description: 'Report one case testing this claim, and the answer it expects.',
          input_schema: {
            type: 'object',
            properties: {
              situation: { type: 'string' },
              question: { type: 'string' },
              expected: { type: 'string' },
              unusable: { type: 'boolean' },
            },
            required: ['situation', 'question', 'expected'],
          },
        },
      ],
      tool_choice: forceTool(WRITE_TOOL),
      messages: [
        {
          role: 'user',
          content: buildPrompt({
            concept: input.concept,
            claim: input.claim,
            check: input.check ?? null,
            asked: input.asked ?? [],
          }),
        },
      ],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, reason: 'error', detail: 'Rate limited. Try again shortly.' };
    }
    return {
      ok: false,
      reason: 'error',
      detail: error instanceof Error ? error.message : 'Writing a case failed.',
    };
  }

  input.onSpend?.({ model: APPLIED_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === WRITE_TOOL);
  if (!block || block.type !== 'tool_use') {
    return { ok: false, reason: 'error', detail: whyNoReport(response) };
  }

  const safe = appliedPayloadSchema.safeParse(block.input);
  if (!safe.success) {
    return { ok: false, reason: 'rejected', detail: 'The case came back malformed.' };
  }

  const result = toAppliedCase(safe.data, input.claim, input.check ?? null);
  if (!result.ok) {
    return result.reason === 'unusable'
      ? {
          ok: false,
          reason: 'unusable',
          detail: 'This claim is too vague to build a case on. It wants rewriting rather than testing.',
        }
      : {
          ok: false,
          reason: 'rejected',
          detail: 'That case did not survive its own check. Ask for another.',
        };
  }

  return { ok: true, case: result.case };
}

/**
 * Grade one typed answer to an applied case. Never throws.
 *
 * The same call and the same schema the opening sweep grades by, with this
 * rung's own system prompt and its own context: the concept, the claim, and
 * the situation the answer was about. One grader with one schema rather than
 * two that drift apart.
 */
export async function gradeAppliedAnswer(input: {
  concept: string;
  claim: string;
  situation: string;
  question: string;
  expected: string;
  response: string;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<WrittenGrade> {
  return gradeWrittenAnswer({
    system: GRADE_SYSTEM,
    context: [
      `Concept: ${input.concept}`,
      `The claim: ${input.claim}`,
      '',
      `The case they were given: ${input.situation}`,
    ],
    question: input.question,
    expected: input.expected,
    response: input.response,
    anthropicApiKey: input.anthropicApiKey,
    client: input.client,
    onSpend: input.onSpend,
  });
}
