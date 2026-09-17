import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import type { ProbeRow } from '@/lib/learn/graph/session';

/**
 * The same wrong answer, twice.
 *
 * The most valuable thing this system produces, and the reason `misconception`
 * is a state of its own rather than a worse `unknown`. Not knowing something is
 * a gap, and reading fixes a gap. Believing something wrong is a thing actively
 * steering you, and more reading of the same kind will not touch it -- you will
 * read straight past the part that contradicts you, because you already know
 * what that part says.
 *
 * It fires on a repeat, never on a single miss. Once is a slip, a misread
 * question, a mis-click. Twice on the same option is a position.
 */

const MODEL = 'claude-haiku-4-5';
const TOOL_NAME = 'name_misconception';

const SYSTEM = `Somebody has answered questions about one idea and picked the same
wrong answer twice. Name what they appear to believe.

ONE SENTENCE, in the second person, describing the belief itself rather than
the mistake: "Believes the trade-off is permanent rather than expectations-
dependent" tells them something; "Got the Phillips curve question wrong" does
not.

BE SPECIFIC ABOUT THE SHAPE OF THE ERROR. The half-step, the reversed
direction, the right mechanism under the wrong condition. That specificity is
the whole value: it is the difference between "revise this topic" and knowing
the one thing to look for.

DO NOT SCOLD, and do not soften. This is a note somebody reads about
themselves, months later, next to a claim they are trying to learn.

IF THE TWO WRONG ANSWERS DO NOT ADD UP to a coherent belief -- they look like
carelessness rather than a position -- set unclear true and name nothing. A
made-up misconception is worse than none: it is a sentence about somebody's
mind that they will believe.`;

export type MisconceptionResult =
  | { ok: true; misconception: string }
  | { ok: false; reason: 'unclear' | 'error'; detail: string };

/**
 * Has the same wrong option been picked twice on this concept?
 *
 * Pure, and by option text rather than by index: the options are regenerated
 * for every question, so index 2 in March and index 2 in April are not the
 * same answer, and comparing them would name a misconception nobody has.
 *
 * An applied case has no options and nothing picked, so it never reaches the
 * count: a misconception is named from the same wrong option twice, and a
 * typed answer has no option to be the same as.
 */
export function repeatedWrongAnswer(probes: ProbeRow[]): { option: string; times: number } | null {
  const counts = new Map<string, number>();

  for (const probe of probes) {
    if (probe.chosenIndex === null) continue;
    if (probe.chosenIndex === probe.correctIndex) continue;
    const chosen = probe.options?.[probe.chosenIndex];
    if (!chosen) continue;
    const key = chosen.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  let worst: { option: string; times: number } | null = null;
  for (const probe of probes) {
    if (probe.chosenIndex === null) continue;
    const chosen = probe.options?.[probe.chosenIndex];
    if (!chosen) continue;
    const times = counts.get(chosen.trim().toLowerCase()) ?? 0;
    if (times >= 2 && (!worst || times > worst.times)) worst = { option: chosen, times };
  }

  return worst;
}

/**
 * Name it. Never throws.
 *
 * One Haiku call, and only ever on a repeat, which is what keeps the spec's
 * cost story true: this is the rarest of the calls in the module.
 */
export async function nameMisconception(input: {
  concept: string;
  claim: string;
  wrongAnswer: string;
  /** The questions where it was picked, so the shape of the error is visible. */
  questions: string[];
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<MisconceptionResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Name what they appear to believe.',
          input_schema: {
            type: 'object',
            properties: {
              misconception: { type: 'string' },
              unclear: { type: 'boolean' },
            },
            required: ['misconception'],
          },
        },
      ],
      messages: [
        {
          role: 'user',
          content: [
            `Concept: ${input.concept}`,
            '',
            `The claim: ${input.claim}`,
            '',
            `The answer they picked twice: ${input.wrongAnswer}`,
            '',
            'The questions where they picked it:',
            ...input.questions.map((question) => `- ${question}`),
            '',
            `Call ${TOOL_NAME}.`,
          ].join('\n'),
        },
      ],
    });
  } catch (error) {
    return {
      ok: false,
      reason: 'error',
      detail: error instanceof Error ? error.message : 'Naming it failed.',
    };
  }

  input.onSpend?.({ model: MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') {
    return { ok: false, reason: 'error', detail: 'The call ran but reported nothing.' };
  }

  const payload = block.input as { misconception?: unknown; unclear?: unknown };
  if (payload.unclear === true) {
    return {
      ok: false,
      reason: 'unclear',
      detail: 'Those two answers do not add up to a belief worth naming.',
    };
  }

  const misconception =
    typeof payload.misconception === 'string' ? payload.misconception.trim() : '';
  if (!misconception) {
    return { ok: false, reason: 'unclear', detail: 'Nothing was named.' };
  }

  return { ok: true, misconception: misconception.slice(0, 500) };
}
