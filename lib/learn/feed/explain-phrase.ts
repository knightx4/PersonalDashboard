import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { MAX_SELECTION, normaliseSelection } from '@/lib/learn/graph/branch';
import { MAX_MATERIAL, TALK_MODEL } from '@/lib/talk/reply';

/**
 * Explaining a phrase somebody selected on a Learn now card (plan #1057).
 *
 * One Sonnet call, like Dash's answers about a card: the phrase, the card's
 * own text and the passage it was written from go in, and a few sentences
 * come out on what the phrase means and how it connects to the card. The same
 * call names the English Wikipedia article that teaches the phrase in the
 * card's sense, so Make it a card has somewhere to write a card from without
 * a second call to find one.
 *
 * The underlined terms of plan #1056 open the same explanation: a tapped term
 * is a phrase that did not need selecting.
 */

export const EXPLAIN_MODEL = TALK_MODEL;
const TOOL_NAME = 'explain_phrase';

/** Longer than this and the call wrote an essay; it is cut at a sentence. */
export const MAX_EXPLANATION = 1_500;
const MAX_TITLE = 200;

export type PhraseExplanation = {
  explanation: string;
  /** The Wikipedia article that teaches the phrase. Null when none fits. */
  article: string | null;
  /** The section of that article, or null for its lead. */
  section: string | null;
};

/**
 * The phrase as it is kept, or why it cannot be explained. Whitespace is
 * flattened as the concept page flattens a selection from a claim, so the same
 * phrase selected across a line break is one phrase.
 */
export function checkedPhrase(raw: string): { phrase: string } | { error: string } {
  const phrase = normaliseSelection(raw);
  if (phrase.length === 0) return { error: 'Select a word or phrase on the card first.' };
  if (phrase.length > MAX_SELECTION) {
    return { error: 'That is a paragraph rather than a phrase. Select the part you want explained.' };
  }
  return { phrase };
}

/**
 * Is this phrase really on the card? The offer only shows over the card, so a
 * phrase from anywhere else did not come from the page. The texts are the
 * card's title and material and the turns of its conversation with Dash,
 * since a phrase in one of Dash's answers can be explained too.
 */
export function phraseOnCard(phrase: string, texts: readonly string[]): boolean {
  const wanted = normaliseSelection(phrase).toLowerCase();
  if (!wanted) return false;
  return texts.some((text) => normaliseSelection(text).toLowerCase().includes(wanted));
}

const SYSTEM = `You are Dash. Somebody reading a card in their learning feed selected a word or phrase on it and wants to know what it means. The card and the passage it was written from are below.

Write three to five sentences. First say plainly what the phrase means, in everyday words. Then say how it connects to this card, naming what the card is about. Where the card or the passage explains the phrase, use that. Where they do not, give the well-established meaning.

Plain prose only. No preamble, no heading, no list, no offer to say more. No dashes used for rhythm and no "not X, but Y" contrasts. Do not refer to "the card", "the passage" or "the selection"; name the subject itself.

Then name the English Wikipedia article that best teaches this phrase in the sense the card uses it, with the title exactly as Wikipedia has it, and the section of that article that explains it best, or null for the article's opening. Name an article only if you are confident it exists. When the phrase is too general or too vague to have an article of its own, give null.

Report through ${TOOL_NAME}.`;

/** The user message: the phrase, then the card. Exported for the test. */
export function explainPrompt(phrase: string, card: { title: string; text: string }): string {
  return [
    `The phrase they selected: "${phrase}"`,
    '',
    `The card: ${card.title.trim()}`,
    '',
    card.text.trim().slice(0, MAX_MATERIAL),
    '',
    `Call ${TOOL_NAME}.`,
  ].join('\n');
}

const payloadSchema = z.object({
  explanation: z.string(),
  article: z.string().nullable().optional(),
  section: z.string().nullable().optional(),
});

/** Cut at the last sentence end within `limit`, or at the limit when there is none. */
function cutAtSentence(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const window = text.slice(0, limit);
  const end = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '));
  return end > limit / 3 ? window.slice(0, end + 1) : window.trimEnd();
}

/** A title, or null for one that is empty, the word null, or implausibly long. */
function title(value: string | null | undefined): string | null {
  const cleaned = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.toLowerCase() === 'null' || cleaned.length > MAX_TITLE) return null;
  return cleaned;
}

/** Read the tool payload, or say why it could not be. Pure; exported for the test. */
export function readExplanation(input: unknown): PhraseExplanation | string {
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) return 'The explanation did not match its schema.';
  const explanation = cutAtSentence(parsed.data.explanation.replace(/\s+/g, ' ').trim(), MAX_EXPLANATION);
  if (!explanation) return 'The explanation came back empty.';
  const article = title(parsed.data.article);
  return { explanation, article, section: article ? title(parsed.data.section) : null };
}

export type ExplainResult = ({ ok: true } & PhraseExplanation) | { ok: false; detail: string };

/** Explain one phrase against one card. Never throws. */
export async function explainPhraseOnCard(input: {
  phrase: string;
  card: { title: string; text: string };
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<ExplainResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  let response;
  try {
    response = await client.messages.create({
      model: EXPLAIN_MODEL,
      max_tokens: 1000,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Give the explanation, and the Wikipedia article that teaches the phrase.',
          input_schema: {
            type: 'object',
            properties: {
              explanation: { type: 'string', description: 'Three to five sentences, plain prose.' },
              article: {
                type: ['string', 'null'],
                description: 'The English Wikipedia article title, exactly, or null.',
              },
              section: {
                type: ['string', 'null'],
                description: "The section heading in that article, or null for the article's opening.",
              },
            },
            required: ['explanation', 'article', 'section'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME),
      messages: [{ role: 'user', content: explainPrompt(input.phrase, input.card) }],
    });
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'The explanation failed.' };
  }

  input.onSpend?.({ model: EXPLAIN_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') return { ok: false, detail: whyNoReport(response) };
  const read = readExplanation(block.input);
  if (typeof read === 'string') return { ok: false, detail: read };
  return { ok: true, ...read };
}
