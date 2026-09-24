import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { describeDepth, type Depth } from './depth';

/**
 * Writing one Learn now card from its fetched section (LEARN-NOW-SPEC, "How
 * cards are made", step 4; plan #807).
 *
 * One call per picked row. The model reads the section as it was stored from
 * Wikipedia and reports whether the section serves the target it was picked
 * for, at the depth it was picked at. When it does, the model writes the
 * card's teaching parts (LEARN-NOW-SPEC, "Cards after the first week"):
 *
 *   context   one plain paragraph setting the scene: what the subject is,
 *             who the names are, when and where, at the person's level
 *   hook      the most interesting thing in the section, stated concretely
 *   summary   what the section says, from its text alone
 *   example   the idea applied to a real case or a worked number
 *   question  one question that makes you use the idea, and its answer
 *
 * A section that does not serve the target, or only restates basics the
 * person is past, is dropped and no card is made.
 *
 * The why line is not the model's. The spec fixes what it says (the field, and
 * either the theme or the gap), so it is built here from the row, and a card
 * can never carry a why line that names the wrong field.
 *
 * Sonnet, for the same reason as the naming call: the spec prices the feed at
 * two Sonnet calls per card.
 */

export const WRITE_CARD_MODEL = 'claude-sonnet-5';

/**
 * The most section text sent in one call. Wikipedia sections stored so far
 * run from three hundred to about nine thousand characters, so this is only
 * reached by an unusually long one, and the model is told when it is.
 */
export const MAX_SECTION_CHARS = 24_000;

/** A summary longer than this is not three or four sentences. */
const MAX_SUMMARY_CHARS = 1_200;
/** The context is one short paragraph. */
const MAX_CONTEXT_CHARS = 900;
/** The hook is one or two sentences. */
const MAX_HOOK_CHARS = 400;
/** The example is two to four sentences, and a worked number can run long. */
const MAX_EXAMPLE_CHARS = 1_000;
const MAX_QUESTION_CHARS = 400;
const MAX_ANSWER_CHARS = 800;

const TOOL_NAME = 'report_card';

/** One picked row, with what it points at. */
export type CardToWrite = {
  id: string;
  reason: 'interest' | 'gap' | 'goal';
  /** The theme it was picked for; set for interest. */
  themeName: string | null;
  /** The goal it was picked for; set for a goal card (plan #900). */
  aimName: string | null;
  /** Null only for a goal card whose goal is not placed in a field. */
  field: { name: string; scope: string } | null;
  /**
   * For a gap: whether the person writes about the field (untested) or has
   * nothing in it at all (untouched). Null for interest.
   */
  gap: 'untested' | 'untouched' | null;
  /** The article's title as Wikipedia has it. */
  article: string;
  /** The section heading, or null for the lead. */
  section: string | null;
  text: string;
  /** The level the pick was made at. Null for a pick made before depth existed. */
  depth: Depth | null;
};

/** What a ready card carries besides its why line. */
export type CardParts = {
  /** One paragraph that sets the scene, first on the card. */
  context: string;
  hook: string;
  summary: string;
  example: string;
  /** Both set, or both null: a question with no answer to check against is left off. */
  question: string | null;
  answer: string | null;
};

export type CardReport =
  | ({ verdict: 'ready' } & CardParts)
  | { verdict: 'dropped'; reason: string };

/**
 * What writing one card came to.
 *
 * `failed` leaves the row picked to be tried again on a later run: the call
 * itself did not happen, so nothing is known about the section. Everything
 * the model did answer ends in `ready` or `dropped`.
 */
export type WriteResult =
  | ({ outcome: 'ready'; why: string } & CardParts)
  | { outcome: 'dropped'; reason: string }
  | { outcome: 'failed'; detail: string };

/**
 * A theme name as it reads mid-sentence. Themes are named in sentence case
 * ("Machine learning architecture"), so the first letter is lowered unless the
 * name has another capital in it, which is taken as a proper noun or an
 * acronym and left alone.
 */
function midSentence(name: string): string {
  const trimmed = name.trim();
  if (/[A-Z]/.test(trimmed.slice(1))) return trimmed;
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

/** The line under the card's title saying why it is in the feed. */
export function whyLine(card: Pick<CardToWrite, 'reason' | 'themeName' | 'aimName' | 'field' | 'gap'>): string {
  if (card.reason === 'goal' && card.aimName) return `For your goal: ${card.aimName.trim()}.`;
  const field = card.field?.name ?? 'a field';
  if (card.reason === 'interest' && card.themeName) {
    return `You write about ${midSentence(card.themeName)} (${field}).`;
  }
  return card.gap === 'untouched'
    ? `A field you have never touched: ${field}.`
    : `A field you write about but have never been tested in: ${field}.`;
}

const SYSTEM = `You write the cards in a learning feed. Each card is one section of an English Wikipedia article, picked for one person. The person found the first version of this feed dull: it summarised sections and so mostly restated definitions they already knew. Your job is to make each card teach something.

You are given what the section was picked for, how deep to pitch it, and the section's text.

1. Decide whether the section serves what it was picked for at that depth. Say it does not when the text is about something else, is a list of links, names or references, is too thin to learn anything from, or only defines terms and restates basics the person is past.

2. When it does, write five parts. The person reads them in this order, knowing nothing about the section beforehand.

context: One paragraph of three or four sentences, first on the card, that lets someone who has never seen this section follow the rest. Say what the subject is in plain terms, where and when it sits, and who any person, school or work the card mentions is (for example: "Elizabeth Eisenstein was a historian who argued in 1979 that..."). Define any term the other parts rely on. Pitch it at the level you were given: skip what someone at that level already knows, and never talk down. You may draw on well-established knowledge here. Simple, clear, descriptive words; no hook, no argument yet.

hook: One or two sentences, after the context. The most interesting, useful or surprising thing in the section, stated concretely: a number, a named case, a consequence, a result that goes against intuition. Never a definition. Never "X is a Y that...".

summary: Two or three sentences on what the section explains, using only what the text says. Add nothing from memory here. State the ideas themselves ("Scribal copying was slow and costly, so..."), never a report on the text ("The section argues...", "It also notes...").

example: Two to four sentences applying the idea to one specific situation: a real event, firm, experiment or policy, or a worked calculation with numbers. You may draw on what you know for this part, but only what is well established; name the case specifically and do not invent figures you are unsure of. If the idea has an obvious everyday application, prefer a less obvious one.

question and answer: One question that makes the person use the idea on a situation, predict an outcome, or explain why something happens. Never ask them to recall a definition or a date. The answer is two or three sentences, and says why.

Style for every part: plain sentences. No slogans, no rhetorical questions outside the question field, no "not X, but Y" contrasts, no dashes used for rhythm. Never refer to "the section", "the article", "the text" or "the author" in any part: the reader has not seen them and the card has to stand on its own. Do not address the reader as "you" outside the question.

Report through ${TOOL_NAME}.`;

const payloadSchema = z.object({
  fit: z.string(),
  matches: z.boolean(),
  context: z.string().nullable().optional(),
  hook: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  example: z.string().nullable().optional(),
  question: z.string().nullable().optional(),
  answer: z.string().nullable().optional(),
});

/** What the model is told the section was picked for. Exported for the test. */
export function describePick(card: CardToWrite): string {
  const field = card.field ? `${card.field.name}. ${card.field.scope}` : '';
  const pick =
    card.reason === 'goal' && card.aimName
      ? `Picked for a goal they set themselves: ${card.aimName}.` +
        (card.field ? ` The field it sits in: ${field}` : ' It sits in no one field.')
      : card.reason === 'interest' && card.themeName
      ? `Picked for a theme from their notes: ${card.themeName}. The field it sits in: ${field}`
      : card.gap === 'untouched'
        ? `Picked as a way into a field they have never studied: ${field}`
        : `Picked as a way into a field they write about and have never been tested in: ${field}`;
  return `${pick}\nHow deep to go: ${describeDepth(card.depth ?? 'working')}`;
}

/** Collapse whitespace; null for nothing. */
function clean(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Read the tool payload.
 *
 * Pure, and exported for the test. `matches: false` drops the card with the
 * model's sentence as the reason. A match with no usable summary, empty or too
 * long to be three or four sentences, is dropped too: the model has answered,
 * and asking it again next hour costs the same call for the same answer.
 */
export function readCardReport(input: unknown): CardReport {
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success)
    return { verdict: 'dropped', reason: 'The report did not match its schema.' };

  const fit = parsed.data.fit.trim();
  if (!parsed.data.matches) {
    return {
      verdict: 'dropped',
      reason: fit || 'The section does not serve what it was picked for.',
    };
  }

  const summary = clean(parsed.data.summary);
  const context = clean(parsed.data.context);
  const hook = clean(parsed.data.hook);
  const example = clean(parsed.data.example);
  if (!summary)
    return { verdict: 'dropped', reason: 'The report matched the section but wrote no summary.' };
  if (summary.length > MAX_SUMMARY_CHARS) {
    return { verdict: 'dropped', reason: `The summary ran to ${summary.length} characters.` };
  }
  // A card with no hook or no example is the old card again, which is the
  // thing the owner asked to stop seeing.
  // A card that opens on the argument with nothing before it is the card
  // the owner found hard to follow.
  if (!context || context.length > MAX_CONTEXT_CHARS) {
    return {
      verdict: 'dropped',
      reason: context
        ? `The context ran to ${context.length} characters.`
        : 'The report wrote no context.',
    };
  }
  if (!hook || hook.length > MAX_HOOK_CHARS) {
    return {
      verdict: 'dropped',
      reason: hook ? `The hook ran to ${hook.length} characters.` : 'The report wrote no hook.',
    };
  }
  if (!example || example.length > MAX_EXAMPLE_CHARS) {
    return {
      verdict: 'dropped',
      reason: example
        ? `The example ran to ${example.length} characters.`
        : 'The report wrote no example.',
    };
  }

  const question = clean(parsed.data.question);
  const answer = clean(parsed.data.answer);
  const asked =
    question &&
    answer &&
    question.length <= MAX_QUESTION_CHARS &&
    answer.length <= MAX_ANSWER_CHARS;
  return {
    verdict: 'ready',
    context,
    hook,
    summary,
    example,
    question: asked ? question : null,
    answer: asked ? answer : null,
  };
}

/** The user message: what it was picked for, then the section. Exported for the test. */
export function cardPrompt(card: CardToWrite): string {
  const text = card.text.trim();
  const cut = text.length > MAX_SECTION_CHARS;
  return [
    describePick(card),
    '',
    `Article: ${card.article}`,
    `Section: ${card.section ?? 'the lead, before the first heading'}`,
    cut ? `The section is long; these are its first ${MAX_SECTION_CHARS} characters.` : '',
    '',
    '<section>',
    cut ? text.slice(0, MAX_SECTION_CHARS) : text,
    '</section>',
    '',
    `Call ${TOOL_NAME}.`,
  ]
    .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
    .join('\n');
}

export async function writeCard(input: {
  card: CardToWrite;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<WriteResult> {
  const { card } = input;
  if (!card.text.trim()) return { outcome: 'dropped', reason: 'The stored section has no text.' };

  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  let response;
  try {
    response = await client.messages.create({
      model: WRITE_CARD_MODEL,
      max_tokens: 2048,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report whether the section serves what it was picked for, and its summary.',
          input_schema: {
            type: 'object',
            properties: {
              fit: {
                type: 'string',
                description:
                  'One sentence on what the section covers and whether it serves what it was picked for at that depth.',
              },
              matches: { type: 'boolean' },
              context: {
                type: ['string', 'null'],
                description:
                  'One plain paragraph setting the scene: what the subject is, who the names are, when and where, and any term the card relies on. Null when it does not match.',
              },
              hook: {
                type: ['string', 'null'],
                description:
                  'One or two concrete sentences: the most interesting thing in it. Null when it does not match.',
              },
              summary: {
                type: ['string', 'null'],
                description:
                  'Two or three sentences from the text alone. Null when it does not match.',
              },
              example: {
                type: ['string', 'null'],
                description:
                  'The idea applied to one specific case or a worked number. Null when it does not match.',
              },
              question: {
                type: ['string', 'null'],
                description:
                  'One question that makes them use the idea. Null when it does not match.',
              },
              answer: {
                type: ['string', 'null'],
                description:
                  'The answer, with why, in two or three sentences. Null when it does not match.',
              },
            },
            required: [
              'fit',
              'matches',
              'context',
              'hook',
              'summary',
              'example',
              'question',
              'answer',
            ],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME),
      messages: [{ role: 'user', content: cardPrompt(card) }],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError)
      return { outcome: 'failed', detail: 'Rate limited.' };
    return {
      outcome: 'failed',
      detail: error instanceof Error ? error.message : 'The writing call failed.',
    };
  }

  // Before the reply is read: a malformed report still cost what it cost.
  input.onSpend?.({ model: WRITE_CARD_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find(
    (part) => part.type === 'tool_use' && part.name === TOOL_NAME,
  );
  if (!block || block.type !== 'tool_use')
    return { outcome: 'dropped', reason: whyNoReport(response) };

  const report = readCardReport(block.input);
  if (report.verdict === 'dropped') return { outcome: 'dropped', reason: report.reason };
  return {
    outcome: 'ready',
    context: report.context,
    hook: report.hook,
    summary: report.summary,
    example: report.example,
    question: report.question,
    answer: report.answer,
    why: whyLine(card),
  };
}
