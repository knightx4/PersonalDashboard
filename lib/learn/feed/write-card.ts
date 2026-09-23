import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';

/**
 * Writing one Learn now card from its fetched section (LEARN-NOW-SPEC, "How
 * cards are made", step 4; plan #807).
 *
 * One call per picked row. The model reads the section as it was stored from
 * Wikipedia and reports two things: whether the section serves the target it
 * was picked for, and a summary of three or four sentences written from that
 * text alone. A section that does not serve the target is dropped and no card
 * is made.
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

const TOOL_NAME = 'report_card';

/** One picked row, with what it points at. */
export type CardToWrite = {
  id: string;
  reason: 'interest' | 'gap';
  /** The theme it was picked for; set for interest. */
  themeName: string | null;
  field: { name: string; scope: string };
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
};

export type CardReport =
  | { verdict: 'ready'; summary: string }
  | { verdict: 'dropped'; reason: string };

/**
 * What writing one card came to.
 *
 * `failed` leaves the row picked to be tried again on a later run: the call
 * itself did not happen, so nothing is known about the section. Everything
 * the model did answer ends in `ready` or `dropped`.
 */
export type WriteResult =
  | { outcome: 'ready'; summary: string; why: string }
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
export function whyLine(card: Pick<CardToWrite, 'reason' | 'themeName' | 'field' | 'gap'>): string {
  const field = card.field.name;
  if (card.reason === 'interest' && card.themeName) {
    return `You write about ${midSentence(card.themeName)} (${field}).`;
  }
  return card.gap === 'untouched'
    ? `A field you have never touched: ${field}.`
    : `A field you write about but have never been tested in: ${field}.`;
}

const SYSTEM = `You write the cards in a reading feed. Each card is one section of an English Wikipedia article, picked for one person.

You are given what the section was picked for and the section's text. Do two things.

1. Decide whether the section serves what it was picked for. For a theme from the person's notes, it has to teach something about the ideas behind that theme. For a field they have never studied, it has to be a sensible first read in that field. Say it does not when the text is about something else, is a list of links, names or references, or is too thin to learn anything from.

2. When it does, write a summary of three or four sentences that tells the person what they will learn if they read it.

The summary:
- Uses only what the text says. Add nothing from memory, even when you know more about the subject.
- States the section's content directly. Do not open with "This section" or "The article", and do not address the reader.
- Is plain: no slogans, no rhetorical questions, no "not X, but Y" contrasts, no dashes used for rhythm.

Report through ${TOOL_NAME}.`;

const payloadSchema = z.object({
  fit: z.string(),
  matches: z.boolean(),
  summary: z.string().nullable().optional(),
});

/** What the model is told the section was picked for. Exported for the test. */
export function describePick(card: CardToWrite): string {
  const field = `${card.field.name}. ${card.field.scope}`;
  if (card.reason === 'interest' && card.themeName) {
    return `Picked for a theme from their notes: ${card.themeName}. The field it sits in: ${field}`;
  }
  return card.gap === 'untouched'
    ? `Picked as a first read in a field they have never studied: ${field}`
    : `Picked as a first read in a field they write about and have never been tested in: ${field}`;
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
  if (!parsed.success) return { verdict: 'dropped', reason: 'The report did not match its schema.' };

  const fit = parsed.data.fit.trim();
  if (!parsed.data.matches) {
    return { verdict: 'dropped', reason: fit || 'The section does not serve what it was picked for.' };
  }

  const summary = (parsed.data.summary ?? '').replace(/\s+/g, ' ').trim();
  if (!summary) return { verdict: 'dropped', reason: 'The report matched the section but wrote no summary.' };
  if (summary.length > MAX_SUMMARY_CHARS) {
    return { verdict: 'dropped', reason: `The summary ran to ${summary.length} characters.` };
  }
  return { verdict: 'ready', summary };
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
      max_tokens: 1024,
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
                description: 'One sentence on what the section covers and whether it serves what it was picked for.',
              },
              matches: { type: 'boolean' },
              summary: {
                type: ['string', 'null'],
                description: 'Three or four sentences from the text alone. Null when it does not match.',
              },
            },
            required: ['fit', 'matches', 'summary'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME),
      messages: [{ role: 'user', content: cardPrompt(card) }],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return { outcome: 'failed', detail: 'Rate limited.' };
    return { outcome: 'failed', detail: error instanceof Error ? error.message : 'The writing call failed.' };
  }

  // Before the reply is read: a malformed report still cost what it cost.
  input.onSpend?.({ model: WRITE_CARD_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') return { outcome: 'dropped', reason: whyNoReport(response) };

  const report = readCardReport(block.input);
  if (report.verdict === 'dropped') return { outcome: 'dropped', reason: report.reason };
  return { outcome: 'ready', summary: report.summary, why: whyLine(card) };
}
