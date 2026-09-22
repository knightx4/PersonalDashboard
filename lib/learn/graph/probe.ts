import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { probePayloadSchema, toProbe, type Probe } from '@/lib/learn/graph/probe-payload';

/**
 * One question, written against one claim.
 *
 * Haiku, chosen rather than defaulted: one claim in, one tightly constrained
 * item out, with no judgment call about a field and nothing to search. It is
 * also the call that happens most often, and the spec's cost story depends on
 * it staying the cheap one.
 *
 * What goes in is the concept's claim and the last few results on it, and
 * nothing else. Not the conversation so far, not the rest of the graph: a
 * session that carried its history would pay for questions one through
 * thirty-nine while writing question forty, which is the difference between a
 * session costing twenty cents and costing ten dollars. Every call here is
 * independent, and all the state is in Postgres.
 */

/** Stored on every probe row, so the two routes that ask record the same thing. */
export const PROBE_MODEL = 'claude-haiku-4-5';
const MODEL = PROBE_MODEL;
const TOOL_NAME = 'report_question';

const SYSTEM = `You write one multiple-choice question testing whether somebody
understands one specific claim.

TEST USE, NOT RECALL OF A NAME. Describe a situation and ask what follows.
Never ask what a thing is called. Somebody who can define the Phillips curve
and cannot say what happens to it when expectations adjust does not understand
the Phillips curve, and a question about the name would call them right.

THREE OR FOUR OPTIONS. Exactly one correct.

THE WRONG OPTIONS MUST BE THINGS SOMEBODY WHO HALF-KNOWS WOULD ACTUALLY PICK.
Take them from the specific ways this idea is usually misunderstood: the
half-step, the reversed direction, the right mechanism with the wrong
condition. An option nobody would choose is a wasted option and makes the
question easier than it looks. Never write filler like "none of the above".

THE REASON MUST STAND ON ITS OWN. Write, in one or two sentences, why the
correct answer is correct -- in terms of the idea, not in terms of the
question. It is shown to the reader after they answer, without the options
beside it, so a reason that says "because the second option is the only one
that fits" teaches nothing. If you cannot write the reason without pointing
back at the options, the question is not about the claim: set unusable true
and write nothing.

AIM AT THE CHECK YOU ARE GIVEN. When the prompt names one check of
understanding, the question tests that check and nothing else. The claim is
there to say what is true; the check is what the question is for. A question
that wanders onto another part of the claim leaves the check untested and the
next question with nowhere new to go.

DO NOT REPEAT A QUESTION you are told has already been asked. Ask about a
different consequence of the same claim.

IF THE CLAIM CANNOT CARRY A QUESTION -- it is too vague to be right or wrong
about, or it is a definition and nothing else -- set unusable true.`;

export type ProbeResult =
  | { ok: true; probe: Probe }
  | { ok: false; reason: 'unusable' | 'rejected' | 'error'; detail: string };

function buildPrompt(input: {
  concept: string;
  claim: string;
  check: string | null;
  otherChecks: string[];
  asked: string[];
  missedBefore: boolean;
}): string {
  const lines = [`Concept: ${input.concept}`];

  // Above the claim, because it is what the question is for. The others are
  // named so the question does not wander onto ground another question will
  // cover.
  if (input.check) {
    lines.push('', `Write the question against this check of understanding: ${input.check}`);
    if (input.otherChecks.length > 0) {
      lines.push('', 'The other checks this claim carries, which this question is not about:');
      for (const other of input.otherChecks) lines.push(`- ${other}`);
    }
  }

  lines.push('', `The claim: ${input.claim}`);

  if (input.asked.length > 0) {
    lines.push('', 'Already asked about this claim — ask about something else:');
    for (const question of input.asked) lines.push(`- ${question}`);
  }

  if (input.missedBefore) {
    // The one piece of history worth its tokens: it changes what the question
    // should be about, rather than merely padding the context.
    lines.push(
      '',
      'They have got this claim wrong before, so aim at the part that is usually misunderstood.',
    );
  }

  lines.push('', `Call ${TOOL_NAME}.`);
  return lines.join('\n');
}

/**
 * Write one question. Never throws.
 *
 * A rejected item -- a reason that only points back at the question, an index
 * outside the options -- is reported rather than repaired. Repairing it would
 * mean writing the missing half here, and the missing half is what decides
 * whether the question is about the claim at all. One wasted call is the price
 * of the cheapest verification there is.
 */
export async function writeProbe(input: {
  concept: string;
  claim: string;
  /** The check this question is for, chosen by `nextMasteryCheck`. */
  check?: string | null;
  /** The concept's other checks, named so the question stays off them. */
  otherChecks?: string[];
  /** Questions already asked about this claim, so it does not repeat itself. */
  asked?: string[];
  missedBefore?: boolean;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<ProbeResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report one question testing this claim.',
          input_schema: {
            type: 'object',
            properties: {
              question: { type: 'string' },
              options: { type: 'array', items: { type: 'string' } },
              correct_index: { type: 'integer' },
              reason: { type: 'string' },
              unusable: { type: 'boolean' },
            },
            required: ['question', 'options', 'correct_index', 'reason'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME),
      messages: [
        {
          role: 'user',
          content: buildPrompt({
            concept: input.concept,
            claim: input.claim,
            check: input.check ?? null,
            otherChecks: input.otherChecks ?? [],
            asked: input.asked ?? [],
            missedBefore: input.missedBefore ?? false,
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
      detail: error instanceof Error ? error.message : 'Writing a question failed.',
    };
  }

  input.onSpend?.({ model: MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') {
    return { ok: false, reason: 'error', detail: whyNoReport(response) };
  }

  const safe = probePayloadSchema.safeParse(block.input);
  if (!safe.success) {
    return { ok: false, reason: 'rejected', detail: 'The question came back malformed.' };
  }

  const result = toProbe(safe.data, input.check ?? null);
  if (!result.ok) {
    return result.reason === 'unusable'
      ? {
          ok: false,
          reason: 'unusable',
          detail: 'This idea is too vague to ask about. It wants rewriting rather than testing.',
        }
      : {
          ok: false,
          reason: 'rejected',
          detail: 'That question did not survive its own check. Ask for another.',
        };
  }

  return { ok: true, probe: result.probe };
}
