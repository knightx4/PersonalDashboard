import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { THINKING_ROOM, forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { describeDepth, type Depth } from './depth';
import { keepMentions, MAX_MENTIONS, type CardMention } from './mentions';
import { MODELS } from '@/lib/core/models';

/**
 * Writing the Learn now cards for one fetched section (LEARN-NOW-SPEC, "How
 * cards are made", step 4, and "One idea per card"; plan #807).
 *
 * One call per picked row. The model reads the section as it was stored from
 * Wikipedia and reports whether the section serves the target it was picked
 * for, at the depth it was picked at. When it does, the model lists the
 * section's ideas, at most three, and writes a card for each:
 *
 *   name      the idea in two to six words, the card's title
 *   takeaway  the claim itself, one plain sentence, shown first
 *   context   only what the claim needs to be followed
 *   hook      the evidence: the number, case or result from the section
 *   summary   why the claim holds, from the section
 *   example   the idea applied to a real case or a worked number
 *   question  one question that makes you use the idea, and its answer
 *   mentions  up to three other ideas the card leans on, in the card's own
 *             words, underlined on the card (plan #1056)
 *
 * The call is given the ideas the person has already met nearest the section,
 * and writes no card for any of them. A section with no idea left, or one that
 * does not serve the target, is dropped and no card is made.
 *
 * The why line is not the model's. The spec fixes what it says (the field, and
 * either the theme or the gap), so it is built here from the row, and a card
 * can never carry a why line that names the wrong field.
 *
 * Sonnet, for the same reason as the naming call: the spec prices the feed at
 * two Sonnet calls per section.
 */


export const WRITE_CARD_MODEL = MODELS.learnWriteCard;

/**
 * The most section text sent in one call. Wikipedia sections stored so far
 * run from three hundred to about nine thousand characters, so this is only
 * reached by an unusually long one, and the model is told when it is.
 */
export const MAX_SECTION_CHARS = 24_000;

/** Cards one section can make. More than three is a section summarised in pieces. */
export const MAX_IDEAS = 3;

/** Ideas already met that are passed to the call, at most. */
export const MAX_KNOWN_IDEAS = 10;

/** The name is a title of two to six words. */
const MAX_NAME_CHARS = 60;
/** The claim is one sentence. */
const MAX_TAKEAWAY_CHARS = 280;
/** Why it holds is two or three sentences. */
const MAX_SUMMARY_CHARS = 900;
/** The context is one short paragraph. */
const MAX_CONTEXT_CHARS = 700;
/** The evidence is one or two sentences. */
const MAX_HOOK_CHARS = 400;
/** The example is two to four sentences, and a worked number can run long. */
const MAX_EXAMPLE_CHARS = 1_000;
const MAX_QUESTION_CHARS = 400;
const MAX_ANSWER_CHARS = 800;

const TOOL_NAME = 'report_ideas';

/** An idea the person has already met, passed so the call does not write it again. */
export type KnownIdea = { name: string; claim: string };

/** One picked row, with what it points at. */
export type CardToWrite = {
  id: string;
  /** The catalogue segment, for finding the ideas already held near it. */
  segmentId?: string | null;
  reason: 'interest' | 'gap' | 'goal' | 'asked' | 'video';
  /** The theme it was picked for; set for interest. */
  themeName: string | null;
  /** The goal it was picked for; set for a goal card (plan #900). */
  aimName: string | null;
  /** The phrase it was asked for, and the card it was on; set for asked (plan #1057). */
  askedPhrase?: string | null;
  askedOn?: string | null;
  /** Null for a goal card whose goal is not placed in a field, and for an asked card. */
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
  /** Ideas already met nearest the section. Empty when none are held or none could be looked up. */
  known?: KnownIdea[];
  /**
   * For a card from a video on the playlist (plan #1067): the video, and the
   * point the judge found in the stretch whose transcript is `text`.
   */
  video?: { title: string; channel: string | null; point: string } | null;
  /** The most cards to keep from the section. MAX_IDEAS when unset; one for a video stretch. */
  maxIdeas?: number;
};

/** One idea's card, named by the columns it is stored in. */
export type IdeaCard = {
  /** Two to six words: the card's title and the concept's name. */
  name: string;
  /** The claim, in one plain sentence, shown first. */
  takeaway: string;
  /** Only what the claim needs to be followed. */
  context: string;
  /** The evidence from the section. */
  hook: string;
  /** Why the claim holds. */
  summary: string;
  example: string;
  /** Both set, or both null: a question with no answer to check against is left off. */
  question: string | null;
  answer: string | null;
  /**
   * Other ideas the card leans on, each in words the card itself uses
   * (plan #1056). Absent on a lesson, whose writer does not name them.
   */
  mentions?: CardMention[];
};

export type CardReport =
  | { verdict: 'ready'; ideas: IdeaCard[] }
  | { verdict: 'dropped'; reason: string };

/**
 * What writing one section came to.
 *
 * `failed` leaves the row picked to be tried again on a later run: the call
 * itself did not happen, so nothing is known about the section. Everything
 * the model did answer ends in `ready` or `dropped`.
 */
export type WriteResult =
  | { outcome: 'ready'; why: string; ideas: IdeaCard[] }
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
export function whyLine(
  card: Pick<CardToWrite, 'reason' | 'themeName' | 'aimName' | 'field' | 'gap' | 'askedPhrase' | 'askedOn'>,
): string {
  if (card.reason === 'video') return 'From a video on your playlist.';
  if (card.reason === 'goal' && card.aimName) return `For your goal: ${card.aimName.trim()}.`;
  if (card.reason === 'asked' && card.askedPhrase) {
    const on = card.askedOn?.trim();
    return on
      ? `You asked for a card on “${card.askedPhrase.trim()}” from ${on}.`
      : `You asked for a card on “${card.askedPhrase.trim()}”.`;
  }
  const field = card.field?.name ?? 'a field';
  if (card.reason === 'interest' && card.themeName) {
    return `You write about ${midSentence(card.themeName)} (${field}).`;
  }
  return card.gap === 'untouched'
    ? `A field you have never touched: ${field}.`
    : `A field you write about but have never been tested in: ${field}.`;
}

const SYSTEM = `You write the cards in a learning feed for one person. Each card teaches one idea, taken from a section of an English Wikipedia article. The section is only the source. The card is not a summary of it.

An idea is one claim that can be stated in a sentence and tested, such as "Startups that run out of money have usually run out of demand first." A definition, a statistic with nothing to explain, a list, or a passing mention is not an idea.

You are given what the section was picked for, how deep to pitch it, the ideas this person has already met, and the section's text.

1. Decide whether the section serves what it was picked for at that depth. Say it does not when the text is about something else, is a list of links, names or references, is too thin to hold an idea, or only defines terms and restates basics the person is past.

2. When it does, list the ideas in the section worth a card, most important first, at most ${MAX_IDEAS}. One is fine; most sections hold one or two. Leave out any idea the person has already met, including one that says the same thing in other words. A fact that supports an idea is evidence for that idea, not an idea of its own. If no idea is left, say the section does not serve.

3. Write a card for each idea. The person reads its parts in this order, knowing nothing about the section beforehand, and each card must stand on its own.

name: The idea in two to six words, as a title ("Demand fails before cash"). Sentence case. At most ${MAX_NAME_CHARS} characters.

claim: The idea as one plain sentence: the thing to remember if they read nothing else. Everyday words, no jargon, no names the reader would have to look up. At most ${MAX_TAKEAWAY_CHARS} characters.

context: Two or three sentences giving only what this claim needs to be followed: the terms it uses and the one or two facts it rests on, pitched at the level you were given. Do not introduce any person, organisation, place or term that the other parts of this card do not use, even if the section mentions it. You may draw on well-established knowledge here. At most ${MAX_CONTEXT_CHARS} characters.

evidence: One or two sentences with the concrete support from the section: a number, a named case, a measured result. Never a definition. At most ${MAX_HOOK_CHARS} characters, so pick the single strongest piece of support rather than listing several.

why: Two or three sentences on why the claim holds: the mechanism or reasoning. Use the section. Where it gives a result without the reason, you may give the well-established reason. State the reasoning itself, never a report on the text ("The section argues..."). At most ${MAX_SUMMARY_CHARS} characters.

example: Two to four sentences applying the idea to one specific situation: a real event, firm, experiment or policy, or a worked calculation with numbers. Only what is well established; name the case and do not invent figures you are unsure of. If the idea has an obvious everyday application, prefer a less obvious one. At most ${MAX_EXAMPLE_CHARS} characters.

question and answer: One question that makes the person use this idea on a situation, predict an outcome, or explain why something happens. Never ask them to recall a definition, a figure or a date. The answer is two or three sentences, and says why. At most ${MAX_QUESTION_CHARS} characters for the question and ${MAX_ANSWER_CHARS} for the answer.

mentions: The two or three other ideas this card leans on that a reader might not know, such as a technique, a named effect or a term of art the card uses without explaining. For each, the phrase copied exactly as it appears in the claim, context, evidence, why or example, and one plain line on why it matters to this card. Pick only words already in the card, never a word you would have to add, and never the card's own name. At most ${MAX_MENTIONS}; give an empty list when the card leans on nothing a reader would stop at.

Style for every part: plain sentences. No slogans, no rhetorical questions outside the question field, no "not X, but Y" contrasts, no dashes used for rhythm. Never refer to "the section", "the article", "the text" or "the author". Do not address the reader as "you" outside the question.

The character limits are hard: a part over its limit is cut back to the whole sentences that fit, and an idea whose claim or first sentence is over it is thrown away. Put the most important sentence of each part first.

Report through ${TOOL_NAME}, with ideas as a list of objects, never as a string.`;

/**
 * A text part: a string, a list of strings read as one paragraph, or anything
 * else read as missing. The tool is not strict, so a part can come back as a
 * list or a number; that leaves the part empty and the length checks name it,
 * rather than failing the whole report.
 */
const text = z.preprocess((value) => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0 && value.every((part) => typeof part === 'string'))
    return value.join(' ');
  return null;
}, z.string().nullable());

const ideaSchema = z.object({
  name: text.optional(),
  claim: text.optional(),
  context: text.optional(),
  evidence: text.optional(),
  why: text.optional(),
  example: text.optional(),
  question: text.optional(),
  answer: text.optional(),
  mentions: z.preprocess(listOf, z.array(z.unknown()).nullable()).optional(),
});

/**
 * A list as the model sent it. Of the cards that never reached the person in
 * September, 32 were dropped as "the report did not match its schema" after a
 * reply of seven hundred to eighteen hundred tokens: the ideas were written,
 * and the report around them was refused. The tool is not strict, and a long
 * nested list is the part models most often hand back as a JSON string (the
 * job suggestions met the same thing; lib/jobs/suggest/payload.ts), or as the
 * one object when only one card was asked for. Both are read as the list.
 */
function listOf(value: unknown): unknown {
  let list = value;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      return value;
    }
  }
  if (list && typeof list === 'object' && !Array.isArray(list)) return [list];
  return list;
}

/** `matches` as a boolean, also when it comes back as "true" or "false". */
const yesNo = z.preprocess(
  (value) =>
    typeof value === 'string'
      ? ({ true: true, false: false, yes: true, no: false } as Record<string, boolean>)[value.trim().toLowerCase()] ?? value
      : value,
  z.boolean(),
);

const payloadSchema = z.object({
  fit: text.optional(),
  matches: yesNo,
  ideas: z.preprocess(listOf, z.array(z.unknown()).nullable()).optional(),
});

/** What the model is told the section was picked for. Exported for the test. */
export function describePick(card: CardToWrite): string {
  const field = card.field ? `${card.field.name}. ${card.field.scope}` : '';
  const video = card.video;
  const pick =
    card.reason === 'video' && video
      ? `Picked from a video they saved to watch: "${video.title}"` +
        (video.channel?.trim() ? ` by ${video.channel.trim()}` : '') +
        `. The part worth a card: ${video.point.trim()}\n` +
        'The section below is the transcript of that part of the video, not a Wikipedia section. ' +
        'Write the one idea that part makes, as one card, and say it does not serve only when the transcript does not make it.'
      : card.reason === 'asked' && card.askedPhrase
      ? `Asked for by name: they met the phrase "${card.askedPhrase.trim()}"` +
        (card.askedOn?.trim() ? ` on a card about ${card.askedOn.trim()}` : '') +
        ' and want a card of its own on it. Write the ideas that explain it, and say the section does not serve only when it is not about it.'
      : card.reason === 'goal' && card.aimName
      ? `Picked for a goal they set themselves: ${card.aimName}.` +
        (card.field ? ` The field it sits in: ${field}` : ' It sits in no one field.')
      : card.reason === 'interest' && card.themeName
      ? `Picked for a theme from their notes: ${card.themeName}. The field it sits in: ${field}`
      : card.gap === 'untouched'
        ? `Picked as a way into a field they have never studied: ${field}`
        : `Picked as a way into a field they write about and have never been tested in: ${field}`;
  return `${pick}\nHow deep to go: ${describeDepth(card.depth ?? 'working')}`;
}

/** Collapse whitespace; empty for nothing. */
function clean(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/** A part that is missing or over its cap, named for the drop reason. */
function badPart(label: string, value: string, cap: number): string | null {
  if (!value) return `no ${label}`;
  if (value.length > cap) return `a ${label} of ${value.length} characters`;
  return null;
}

/** Where one sentence ends and the next begins: a stop, any closing mark, a space, then a capital, digit or quote. */
const SENTENCE_BREAK = /(?<=[.!?][\u201d"')\]]?)\s+(?=[A-Z0-9\u201c"(])/;

/**
 * A part over its cap, cut back to the whole sentences that fit.
 *
 * Every card dropped for its length in September was a part that ran a
 * sentence or two past its cap (an evidence part of 407 to 549 characters
 * against 400, a why part of 1,232 to 1,695 against 900). The first sentences
 * carry the point, so the card keeps them rather than being thrown away. A
 * part whose first sentence alone is over the cap is left as it is, and the
 * length check drops the idea as before: cutting inside a sentence would show
 * half a claim. Exported for the test.
 */
export function fitToCap(value: string, cap: number): string {
  if (value.length <= cap) return value;
  let kept = '';
  for (const sentence of value.split(SENTENCE_BREAK)) {
    const next = kept ? `${kept} ${sentence}` : sentence;
    if (next.length > cap) break;
    kept = next;
  }
  return kept || value;
}

/** One idea read from the payload, or why it was left out. */
function readIdea(input: unknown): IdeaCard | string {
  const parsed = ideaSchema.safeParse(input);
  if (!parsed.success) return 'an idea that did not match its schema';

  // The name is a title and the claim one sentence, so neither is cut: one
  // over its cap is a different idea, and is left out.
  const name = clean(parsed.data.name);
  const takeaway = clean(parsed.data.claim);
  const context = fitToCap(clean(parsed.data.context), MAX_CONTEXT_CHARS);
  const hook = fitToCap(clean(parsed.data.evidence), MAX_HOOK_CHARS);
  const summary = fitToCap(clean(parsed.data.why), MAX_SUMMARY_CHARS);
  const example = fitToCap(clean(parsed.data.example), MAX_EXAMPLE_CHARS);
  const problem =
    badPart('name', name, MAX_NAME_CHARS) ??
    badPart('claim', takeaway, MAX_TAKEAWAY_CHARS) ??
    badPart('context', context, MAX_CONTEXT_CHARS) ??
    badPart('evidence', hook, MAX_HOOK_CHARS) ??
    badPart('reason why', summary, MAX_SUMMARY_CHARS) ??
    badPart('example', example, MAX_EXAMPLE_CHARS);
  if (problem) return problem;

  const question = clean(parsed.data.question);
  const answer = fitToCap(clean(parsed.data.answer), MAX_ANSWER_CHARS);
  const asked =
    question &&
    answer &&
    question.length <= MAX_QUESTION_CHARS &&
    answer.length <= MAX_ANSWER_CHARS;
  // A mention whose words the card does not use is dropped on its own: the
  // explanation it opens refuses a phrase that is not on the card.
  const mentions = keepMentions(parsed.data.mentions, {
    name,
    texts: [takeaway, context, hook, summary, example],
  });
  return {
    name,
    takeaway,
    context,
    hook,
    summary,
    example,
    question: asked ? question : null,
    answer: asked ? answer : null,
    mentions,
  };
}

/**
 * Read the tool payload.
 *
 * Pure, and exported for the test. `matches: false` drops the section with the
 * model's sentence as the reason. Each idea is read on its own: one with a part
 * missing or too long is left out and the others stand. A match with no usable
 * idea is dropped too: the model has answered, and asking it again next hour
 * costs the same call for the same answer. Two ideas with the same name are one
 * idea, and ideas past the third are not kept.
 */
export function readCardReport(input: unknown): CardReport {
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) {
    // Name the field, so the next refusal says what the reply looked like.
    const where = parsed.error.issues.map((issue) => issue.path.join('.') || 'the report').join(', ');
    return { verdict: 'dropped', reason: `The report did not match its schema (${where}).` };
  }

  const fit = clean(parsed.data.fit);
  if (!parsed.data.matches) {
    return {
      verdict: 'dropped',
      reason: fit || 'The section does not serve what it was picked for.',
    };
  }

  const ideas: IdeaCard[] = [];
  const problems: string[] = [];
  for (const raw of parsed.data.ideas ?? []) {
    const idea = readIdea(raw);
    if (typeof idea === 'string') problems.push(idea);
    else if (!ideas.some((kept) => kept.name.toLowerCase() === idea.name.toLowerCase())) ideas.push(idea);
  }
  if (ideas.length === 0) {
    return {
      verdict: 'dropped',
      reason: problems.length > 0
        ? `No idea was usable: ${problems.join('; ')}.`
        : 'The report matched the section but wrote no idea.',
    };
  }
  return { verdict: 'ready', ideas: ideas.slice(0, MAX_IDEAS) };
}

/** The user message: what it was picked for, what they have met, then the section. Exported for the test. */
export function cardPrompt(card: CardToWrite): string {
  const text = card.text.trim();
  const cut = text.length > MAX_SECTION_CHARS;
  const known = (card.known ?? []).slice(0, MAX_KNOWN_IDEAS);
  return [
    describePick(card),
    '',
    known.length > 0
      ? `Ideas they have already met, which get no card:\n${known
          .map((idea) => `- ${idea.name}: ${idea.claim}`)
          .join('\n')}`
      : 'They have met no ideas close to this section yet.',
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

const ideaPart = (description: string) => ({ type: ['string', 'null'], description });

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
      max_tokens: 6144 + THINKING_ROOM,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report whether the section serves what it was picked for, and a card for each of its ideas.',
          input_schema: {
            type: 'object',
            properties: {
              fit: {
                type: 'string',
                description:
                  'One sentence on what the section covers and whether it serves what it was picked for at that depth.',
              },
              matches: { type: 'boolean' },
              ideas: {
                type: 'array',
                description: `One card per idea, as a list of objects, most important first, at most ${MAX_IDEAS}. An empty list when it does not match.`,
                items: {
                  type: 'object',
                  properties: {
                    name: ideaPart(`The idea in two to six words, as a title. At most ${MAX_NAME_CHARS} characters.`),
                    claim: ideaPart(`The idea as one plain sentence. At most ${MAX_TAKEAWAY_CHARS} characters.`),
                    context: ideaPart(`Only the terms and facts this claim needs, in two or three sentences. At most ${MAX_CONTEXT_CHARS} characters.`),
                    evidence: ideaPart(`The single strongest support from the section: a number, a case or a result, in one or two sentences. At most ${MAX_HOOK_CHARS} characters.`),
                    why: ideaPart(`Why the claim holds, in two or three sentences. At most ${MAX_SUMMARY_CHARS} characters.`),
                    example: ideaPart(`The idea applied to one specific case or a worked number. At most ${MAX_EXAMPLE_CHARS} characters.`),
                    question: ideaPart(`One question that makes them use the idea. At most ${MAX_QUESTION_CHARS} characters.`),
                    answer: ideaPart(`The answer, with why, in two or three sentences. At most ${MAX_ANSWER_CHARS} characters.`),
                    mentions: {
                      type: 'array',
                      description: `Up to ${MAX_MENTIONS} other ideas the card leans on, each in words copied exactly from the card.`,
                      items: {
                        type: 'object',
                        properties: {
                          phrase: { type: 'string', description: 'The words exactly as the card has them.' },
                          why: { type: 'string', description: 'One plain line on why it matters to this card.' },
                        },
                        required: ['phrase', 'why'],
                      },
                    },
                  },
                  required: ['name', 'claim', 'context', 'evidence', 'why', 'example', 'question', 'answer', 'mentions'],
                },
              },
            },
            required: ['fit', 'matches', 'ideas'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME, WRITE_CARD_MODEL),
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
  const keep = Math.max(1, Math.min(card.maxIdeas ?? MAX_IDEAS, MAX_IDEAS));
  return { outcome: 'ready', ideas: report.ideas.slice(0, keep), why: whyLine(card) };
}
