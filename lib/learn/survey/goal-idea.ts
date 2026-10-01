import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { cardDepthForAim, type AimDepth } from '@/lib/learn/aims';
import { depthFor, describeDepth, knownCountFor, type Depth } from '@/lib/learn/feed/depth';
import { kindSchema, masterySchema } from '@/lib/learn/graph/chain-payload';
import { KIND_RULE, KIND_TOOL_FIELD } from '@/lib/learn/graph/kind-prompt';
import { MASTERY_RULE, MASTERY_TOOL_FIELD } from '@/lib/learn/graph/mastery-prompt';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { folded, SURVEY_NOTE_CHARS, type IdeaResult, type SurveyIdea } from './idea';

/**
 * The idea a Practice Flow question about a learning goal tests (plan #1383).
 *
 * A goal's question is written first from a goal card the person marked Got it
 * or saved, so they are tested on what they read: the idea is read from the
 * section the card was cut from and has to quote it, with the same quote check
 * `idea.ts` applies to notes. With no such card left, it comes from the goal's
 * own name and about line, and there is nothing to quote.
 *
 * Either way the idea is pitched at the goal's level. That starts where the
 * goal's cards start (familiar is working, solid advanced, deep specialist,
 * as `cardDepthForAim` sets them) and each right answer on the goal counts as
 * a known card does in `depth.ts`, so two right answers on a familiar goal
 * move its next idea up to advanced (#909).
 *
 * Haiku, as for the theme ideas: picking a claim out of text, or naming one
 * inside a subject, not judging whether it is true.
 */

const MODEL = 'claude-haiku-4-5';
const TOOL_NAME = 'report_idea';

/** The shortest quote accepted from a card's section. */
const MIN_QUOTE_CHARS = 20;

/** A goal card the person marked Got it or saved, with the section it was cut from. */
export type GoalCardSource = {
  cardId: string;
  /** "Article: Section", as the card showed it. */
  title: string;
  /** The section's text as stored in the catalogue. */
  text: string;
};

export type GoalIdeaSource = {
  aim: { id: string; name: string; about: string | null };
  depth: Depth;
  /** Null to write from the goal's own wording. */
  card: GoalCardSource | null;
};

/**
 * The level a goal's next question is pitched at: the goal's starting depth,
 * counted up by one for each right answer on it, on the thresholds goal cards
 * use.
 */
export function goalQuestionDepth(start: AimDepth, rightAnswers: number): Depth {
  return depthFor(knownCountFor(cardDepthForAim(start)) + Math.max(0, rightAnswers));
}

/** What the basis of an idea from a card starts with, so the card reads as used. */
export function cardBasisPrefix(title: string): string {
  return `From the card "${title}"`;
}

/** The section as it is sent: the start of it, up to the limit. */
export function sectionExcerpt(text: string): string {
  return text.length > SURVEY_NOTE_CHARS ? text.slice(0, SURVEY_NOTE_CHARS) : text;
}

const COMMON = `ONE SPECIFIC CLAIM. Something that could be true or false and that a person
could get wrong: "A startup's burn multiple is net burn divided by net new
annual recurring revenue, so it worsens when growth slows even if spending is
flat". Not the subject's name, not a topic heading, not "the section discusses X".

NOT ONE ALREADY TAKEN. You may be given ideas already written for this goal.
Pick a different one.

PITCHED AT THEIR LEVEL. You are told how far along they are. Pick an idea at
that level, not the introduction to the subject.

${MASTERY_RULE}

${KIND_RULE}`;

const CARD_SYSTEM = `Somebody is learning a subject they set as a goal. They read one section of an
article about it and said they had it. Pick ONE idea from that section that a
single question could test, so they are tested on what they read.

FROM THE SECTION. The idea must be stated in the section you are given. Quote
the sentence or phrase it comes from exactly as it is written. Do not bring in
anything the section does not say.

${COMMON}

IF THE SECTION HOLDS NO CLAIM -- it is a list of names, links or works -- set
none true and leave the rest empty.`;

const WORDING_SYSTEM = `Somebody set a subject as a learning goal and has not been tested on it. Pick
ONE idea inside that subject that a single question could test: a claim
anybody who knows the subject at their level would hold, stated so it is
right as written. Leave the quote empty.

${COMMON}

IF THE GOAL IS TOO VAGUE TO NAME ANY CLAIM IN IT, set none true and leave the
rest empty.`;

const payloadSchema = z.object({
  none: z.boolean().optional(),
  name: z.string().optional().default(''),
  claim: z.string().optional().default(''),
  quote: z.string().optional().default(''),
  mastery: masterySchema,
  kind: kindSchema,
});

/**
 * Check a reported idea: it has a claim, it is not the goal's name or one
 * already written, and, from a card, its quote is in the part of the section
 * that was sent. Returns the reason it fails, or null when it holds.
 */
export function whyGoalIdeaUngrounded(
  report: { name: string; claim: string; quote: string },
  source: GoalIdeaSource,
  existing: readonly string[],
): string | null {
  if (!report.name.trim() || !report.claim.trim()) return 'The idea came back without a claim.';
  if (source.card) {
    const quote = folded(report.quote.replace(/^["'“‘]+|["'”’]+$/g, ''));
    if (quote.length < MIN_QUOTE_CHARS) return 'The idea came back without a quote from the section.';
    if (!folded(sectionExcerpt(source.card.text)).includes(quote)) {
      return `The quote is not in "${source.card.title}".`;
    }
  }
  const name = folded(report.name);
  if (name === folded(source.aim.name)) return "The idea is the goal's name.";
  if (existing.some((taken) => folded(taken) === name)) return 'The idea is one already written.';
  return null;
}

/** The prompt for one goal idea. Exported for the test. */
export function describeGoalIdea(source: GoalIdeaSource, existing: readonly string[]): string {
  const lines = [`Their goal: ${source.aim.name}`];
  if (source.aim.about?.trim()) lines.push(`What they mean by it: ${source.aim.about.trim()}`);
  lines.push('', `Their level: ${describeDepth(source.depth)}`);
  if (source.card) {
    lines.push('', `The section they read: ${source.card.title}`, '"""', sectionExcerpt(source.card.text), '"""');
  }
  if (existing.length > 0) {
    lines.push('', 'Ideas already written for this goal:', ...existing.map((n) => `- ${n}`));
  }
  lines.push('', `Call ${TOOL_NAME}.`);
  return lines.join('\n');
}

/**
 * Ask for one idea for a goal question, from the card's section when there is
 * one and from the goal's wording when not, and check it.
 *
 * Pure apart from the model call, so it can be tested with a stub client.
 */
export async function ideaForGoal(input: {
  source: GoalIdeaSource;
  /** Names of the ideas already in the goal's survey subject. */
  existing: readonly string[];
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<IdeaResult> {
  const { source } = input;
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: source.card ? CARD_SYSTEM : WORDING_SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the one idea a question on this goal should test.',
          input_schema: {
            type: 'object',
            properties: {
              none: { type: 'boolean' },
              name: { type: 'string', description: 'The idea, as a short claim.' },
              claim: { type: 'string', description: 'The claim in one or two sentences.' },
              quote: {
                type: 'string',
                description: source.card
                  ? 'The words in the section it is taken from.'
                  : 'Leave empty.',
              },
              mastery: MASTERY_TOOL_FIELD,
              kind: KIND_TOOL_FIELD,
            },
            required: ['name', 'claim'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME),
      messages: [{ role: 'user', content: describeGoalIdea(source, input.existing) }],
    });
  } catch (error) {
    return {
      ok: false,
      reason: 'error',
      detail: error instanceof Error ? error.message : 'Writing the idea failed.',
    };
  }

  input.onSpend?.({ model: MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') {
    return { ok: false, reason: 'error', detail: whyNoReport(response) };
  }

  const parsed = payloadSchema.safeParse(block.input);
  if (!parsed.success) {
    return { ok: false, reason: 'error', detail: 'The idea came back in the wrong shape.' };
  }
  const report = parsed.data;
  if (report.none) {
    return {
      ok: false,
      reason: 'nothing-in-it',
      detail: source.card
        ? `"${source.card.title}" holds no claim to test.`
        : `"${source.aim.name}" is too vague to name a claim in.`,
    };
  }

  const reported = {
    name: report.name.trim(),
    claim: report.claim.trim(),
    quote: source.card ? report.quote.trim() : '',
  };
  const why = whyGoalIdeaUngrounded(reported, source, input.existing);
  if (why) return { ok: false, reason: 'ungrounded', detail: why };

  const idea: SurveyIdea = {
    name: reported.name,
    claim: reported.claim,
    basis: source.card
      ? `${cardBasisPrefix(source.card.title)} in Learn now: "${reported.quote}"`
      : `From your goal "${source.aim.name}"`,
    noteTitle: source.card?.title ?? '',
    quote: reported.quote,
    mastery: report.mastery.length > 0 ? report.mastery : null,
    kind: report.kind,
  };
  return { ok: true, idea };
}
