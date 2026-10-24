import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import type { ProbeRow } from '@/lib/learn/graph/session';
import { MODELS } from '@/lib/core/models';
import { GUESS_MAX, isMisconceptionCandidate } from '@/lib/learn/confidence';

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
 * Without anything else to go on it fires on a repeat, never on a single miss.
 * Once is a slip, a misread question, a mis-click. Twice on the same option is
 * a position. An answer can carry more than the option, though (plan #2522.4):
 * a wrong answer given at Fairly sure or Certain is a position held with
 * confidence, and a wrong answer with the person's own reasoning beside it
 * shows what they were thinking. Either is enough alone, and the reasoning goes
 * to the namer, so the sentence is about what they wrote rather than a guess
 * from the option.
 */

const MODEL = MODELS.learnMisconception;
const TOOL_NAME = 'name_misconception';

const SYSTEM = `Somebody has answered a question about one idea wrongly. It is either the
same wrong answer picked twice, one wrong answer they were sure of, or one wrong
answer with their reasoning written beside it. Name what they appear to believe.

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

WHEN THEIR REASONING IS GIVEN, NAME THE BELIEF IT SHOWS, in their terms, rather
than the belief the wrong option would suggest on its own.

IF THE WRONG ANSWERS DO NOT ADD UP to a coherent belief -- they look like
carelessness rather than a position -- set unclear true and name nothing. A
made-up misconception is worse than none: it is a sentence about somebody's
mind that they will believe.`;

/** Why an answer is worth naming a misconception from. */
export type MisconceptionBasis = 'confident' | 'reasoned' | 'repeated';

/**
 * Whether this answer is worth a naming call, and on what ground. Pure.
 *
 * Only a wrong answer ever is. A wrong answer at Fairly sure or Certain
 * stands alone (`confident`). One with reasoning beside it stands alone too
 * (`reasoned`) unless it was given as a guess, since a guess says nothing
 * about what is believed. Anything else needs the same wrong option twice
 * (`repeated`), which is the rule an answer with neither signal has always
 * followed.
 */
export function misconceptionBasis(input: {
  correct: boolean;
  confidence?: number | null;
  reasoning?: string | null;
  repeated?: boolean;
}): MisconceptionBasis | null {
  if (input.correct) return null;
  if (isMisconceptionCandidate({ correct: false, confidence: input.confidence })) return 'confident';
  const guessed = typeof input.confidence === 'number' && input.confidence <= GUESS_MAX;
  if (!guessed && (input.reasoning ?? '').trim() !== '') return 'reasoned';
  if (input.repeated) return 'repeated';
  return null;
}

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
  /** What they wrote beside the wrong answer(s), when they wrote anything. */
  reasoning?: string[];
  /** Why this is being named; read by the prompt only to word the opening line. */
  basis?: MisconceptionBasis;
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
      tool_choice: forceTool(TOOL_NAME, MODEL),
      messages: [
        {
          role: 'user',
          content: [
            `Concept: ${input.concept}`,
            '',
            `The claim: ${input.claim}`,
            '',
            input.basis && input.basis !== 'repeated'
              ? `The wrong answer they gave${input.basis === 'confident' ? ' while sure of it' : ''}: ${input.wrongAnswer}`
              : `The answer they picked twice: ${input.wrongAnswer}`,
            '',
            'The questions where they gave it:',
            ...input.questions.map((question) => `- ${question}`),
            ...(input.reasoning && input.reasoning.length > 0
              ? ['', 'Their reasoning, written beside the answer:', ...input.reasoning.map((r) => `- ${r}`)]
              : []),
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
    return { ok: false, reason: 'error', detail: whyNoReport(response) };
  }

  const payload = block.input as { misconception?: unknown; unclear?: unknown };
  if (payload.unclear === true) {
    return {
      ok: false,
      reason: 'unclear',
      detail: 'Those answers do not add up to a belief worth naming.',
    };
  }

  const misconception =
    typeof payload.misconception === 'string' ? payload.misconception.trim() : '';
  if (!misconception) {
    return { ok: false, reason: 'unclear', detail: 'Nothing was named.' };
  }

  return { ok: true, misconception: misconception.slice(0, 500) };
}
