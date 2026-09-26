import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { OPENING_MODEL } from '@/lib/learn/graph/opening-probe';
import type { ExplanationMarking, Marking } from './teach-back';

/**
 * Marking a teach-back (plan #1054): the explanation, which also writes the
 * one follow-up question, and then the answer to that question.
 *
 * Haiku, the same model and the same forced-tool shape as gradeWrittenAnswer
 * in lib/learn/graph/opening-probe.ts: one idea and one answer in, a tightly
 * constrained verdict out. The marks are lists rather than one sentence
 * because the card shows what was right and what was missing separately.
 * Both calls record under `mark-teach-back` through `onSpend`.
 */

export const TEACH_BACK_MODEL = OPENING_MODEL;
const EXPLAIN_TOOL = 'report_marking';
const FOLLOW_TOOL = 'report_follow_up_marking';

/** The idea asked about, as its concept row holds it. */
export type TeachBackIdea = { name: string; claim: string; basis: string };

const MARKING_RULES = `MARK THE IDEA, NOT THE WORDING. They are writing from memory, in their own
words. A rough phrasing or a missing term is fine if what they said is the
thing the claim says.

HOLDS MEANS THE SUBSTANCE IS RIGHT. The explanation holds when it states what
the claim states and gives the reason it is true, near enough that a friend
would come away with the right idea. Right direction with the wrong mechanism
does not hold. Restating the name, or saying nothing in more words, does not
hold. Be strict: an idea marked on this is recorded as known or sharp, and a
lenient mark overstates what they know.

RIGHT AND MISSING ARE SHORT POINTS, a phrase each, at most four of each, in
plain words addressed to them ("you said ...", not "the student said ...").
Missing includes anything they got wrong. Leave a list empty rather than pad
it.`;

const EXPLAIN_SYSTEM = `You are marking somebody's explanation of one idea they met a few days ago,
written as if to a friend, against the idea's claim and the basis for it.

${MARKING_RULES}

OWN EXAMPLE is true only when they gave a concrete example of their own. An
example copied from the claim or the basis does not count, and neither does a
vague "for instance, in many situations".

THEN WRITE ONE FOLLOW-UP QUESTION, the strongest one for this explanation:
where it holds, a question that tests it past the words they used -- a case
the idea has to handle, or the objection it has to answer; where it does not,
a question that points at the part they missed. Answerable in two or three
sentences, from what they should know, without the answer in the question.
Write the answer you expect alongside it, in one or two sentences.

Write why in one sentence first.`;

const FOLLOW_SYSTEM = `You are marking somebody's answer to one follow-up question about an idea,
asked after they explained the idea back in their own words.

${MARKING_RULES}

Here HOLDS means the answer to the follow-up is right in substance, measured
against the answer expected and the claim.

Write why in one sentence first.`;

const markingFields = {
  why: { type: 'string' },
  holds: { type: 'boolean' },
  right: { type: 'array', items: { type: 'string' } },
  missing: { type: 'array', items: { type: 'string' } },
} as const;

const MAX_POINTS = 4;

const pointsSchema = z
  .array(z.string())
  .transform((points) => points.map((point) => point.trim()).filter(Boolean).slice(0, MAX_POINTS));

const markingSchema = z.object({
  why: z.string().trim().min(1),
  holds: z.boolean(),
  right: pointsSchema,
  missing: pointsSchema,
});

const explanationSchema = markingSchema.extend({
  own_example: z.boolean(),
  follow_up: z.string().trim().min(1),
  follow_up_expected: z.string().trim().min(1),
});

function ideaLines(idea: TeachBackIdea): string[] {
  return [`Idea: ${idea.name}`, `The claim: ${idea.claim}`, `The basis for it: ${idea.basis}`];
}

export type MarkedExplanation =
  | { ok: true; marking: ExplanationMarking; followUp: string; followUpExpected: string }
  | { ok: false; detail: string };

async function call(
  client: Anthropic,
  input: {
    system: string;
    tool: string;
    description: string;
    properties: Record<string, unknown>;
    required: string[];
    content: string;
    onSpend?: SpendSink;
  },
): Promise<{ ok: true; input: unknown } | { ok: false; detail: string }> {
  let response;
  try {
    response = await client.messages.create({
      model: TEACH_BACK_MODEL,
      max_tokens: 1024,
      system: input.system,
      tools: [
        {
          name: input.tool,
          description: input.description,
          input_schema: { type: 'object', properties: input.properties, required: input.required },
        },
      ],
      tool_choice: forceTool(input.tool),
      messages: [{ role: 'user', content: input.content }],
    });
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'Marking failed.' };
  }

  // Before the answer is judged: a useless one still cost what it cost.
  input.onSpend?.({ model: TEACH_BACK_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === input.tool);
  if (!block || block.type !== 'tool_use') return { ok: false, detail: whyNoReport(response) };
  return { ok: true, input: block.input };
}

/** Mark the explanation and write the follow-up. Never throws. */
export async function markExplanation(input: {
  idea: TeachBackIdea;
  prompt: string;
  response: string;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<MarkedExplanation> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  const result = await call(client, {
    system: EXPLAIN_SYSTEM,
    tool: EXPLAIN_TOOL,
    description: 'Report the marking of the explanation and the one follow-up question.',
    properties: {
      ...markingFields,
      own_example: { type: 'boolean' },
      follow_up: { type: 'string' },
      follow_up_expected: { type: 'string' },
    },
    required: ['why', 'holds', 'right', 'missing', 'own_example', 'follow_up', 'follow_up_expected'],
    content: [
      ...ideaLines(input.idea),
      '',
      `What they were asked: ${input.prompt}`,
      '',
      `What they wrote: ${input.response}`,
      '',
      `Call ${EXPLAIN_TOOL}.`,
    ].join('\n'),
    onSpend: input.onSpend,
  });
  if (!result.ok) return result;

  const safe = explanationSchema.safeParse(result.input);
  if (!safe.success) return { ok: false, detail: 'The marking came back malformed.' };
  const { own_example, follow_up, follow_up_expected, ...marking } = safe.data;
  return {
    ok: true,
    marking: { ...marking, ownExample: own_example },
    followUp: follow_up,
    followUpExpected: follow_up_expected,
  };
}

export type MarkedFollowUp = { ok: true; marking: Marking } | { ok: false; detail: string };

/** Mark the answer to the follow-up. Never throws. */
export async function markFollowUp(input: {
  idea: TeachBackIdea;
  explanation: string;
  followUp: string;
  expected: string;
  response: string;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<MarkedFollowUp> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  const result = await call(client, {
    system: FOLLOW_SYSTEM,
    tool: FOLLOW_TOOL,
    description: 'Report the marking of the answer to the follow-up question.',
    properties: { ...markingFields },
    required: ['why', 'holds', 'right', 'missing'],
    content: [
      ...ideaLines(input.idea),
      '',
      `Their explanation of it: ${input.explanation}`,
      '',
      `Follow-up asked: ${input.followUp}`,
      `Answer expected: ${input.expected}`,
      '',
      `What they wrote: ${input.response}`,
      '',
      `Call ${FOLLOW_TOOL}.`,
    ].join('\n'),
    onSpend: input.onSpend,
  });
  if (!result.ok) return result;

  const safe = markingSchema.safeParse(result.input);
  if (!safe.success) return { ok: false, detail: 'The marking came back malformed.' };
  return { ok: true, marking: safe.data };
}
