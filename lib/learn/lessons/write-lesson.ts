import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import type { IdeaCard } from '@/lib/learn/feed/write-card';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import type { LessonSource } from './closest-source';

/**
 * Writing the lesson for one concept in a track (LEARN-LESSONS-SPEC, "A
 * lesson"; plan #976).
 *
 * One Sonnet call. The lesson has the parts of a Learn now idea card and is
 * returned in the same column-named shape (`IdeaCard`), so the feed stores it
 * the way it stores a card. It is written from the model's knowledge. When the
 * catalogue holds a section close to the claim (`findLessonSource`), the call
 * reads it, says whether it supports the claim, contradicts it or is about
 * something else, and takes its evidence from it where it can.
 *
 * The title is the concept's name, set here rather than by the model, so a
 * lesson can never be titled differently from the concept it teaches.
 *
 * A lesson is dropped, and nothing is served, when the source contradicts the
 * claim (the contradiction is returned for the row), when the model cannot
 * vouch for the claim from what it knows, and when a part is missing or too
 * long. A call that did not happen is `failed`, and the concept can be tried
 * again.
 */

export const WRITE_LESSON_MODEL = 'claude-sonnet-5';

/**
 * The most source text sent in one call. Catalogue segments run to 7,300
 * characters at the 99th percentile and 34,000 at the longest, so only the
 * longest few are cut, and the model is told when one is.
 */
export const MAX_SOURCE_CHARS = 12_000;

/** Prerequisites named in the prompt, at most. */
export const MAX_PREREQUISITES = 8;

/** Mastery checks named in the prompt, at most (MASTERY_MAX in chain-payload). */
const MAX_CHECKS = 4;

const MAX_TAKEAWAY_CHARS = 280;
const MAX_CONTEXT_CHARS = 700;
const MAX_HOOK_CHARS = 400;
const MAX_SUMMARY_CHARS = 900;
const MAX_EXAMPLE_CHARS = 1_000;
const MAX_QUESTION_CHARS = 400;
const MAX_ANSWER_CHARS = 800;
/** One sentence about the source. */
const MAX_SOURCE_NOTE_CHARS = 400;

const TOOL_NAME = 'report_lesson';

/** The concept a lesson teaches, as its row in learn.concepts holds it. */
export type LessonConcept = {
  name: string;
  claim: string;
  /** The row's mastery checks, when it has them. */
  mastery?: string[] | null;
};

export type LessonToWrite = {
  concept: LessonConcept;
  trackName: string;
  /** The unit the concept sits in, when known. */
  unit?: { title: string; outcome: string | null } | null;
  /** Names of the concept's prerequisites, which the lesson may build on. */
  prerequisites?: string[];
  /** The closest catalogue section, from `findLessonSource`, or null. */
  source: LessonSource | null;
};

/** The source a lesson used, as the row stores it. */
export type LessonSourceUsed = {
  segmentId: string;
  itemTitle: string;
  heading: string | null;
};

/** What the model said about the source it was given. */
export type SourceVerdict = 'supports' | 'contradicts' | 'unrelated';

export type LessonReport =
  | {
      verdict: 'ready';
      card: Omit<IdeaCard, 'name'>;
      /** Null when no source was given. */
      source: { verdict: SourceVerdict; note: string } | null;
    }
  | { verdict: 'dropped'; reason: string; contradicted: boolean };

/**
 * What writing one lesson came to.
 *
 * `ready` carries the source only when the model said the section supports
 * the claim; a section it called unrelated is left off. `dropped` with
 * `contradicted` set is the case the spec keeps on the row: the source is
 * named and the reason is the model's sentence on the contradiction.
 */
export type LessonResult =
  | { outcome: 'ready'; card: IdeaCard; source: LessonSourceUsed | null }
  | { outcome: 'dropped'; reason: string; contradicted: boolean; source: LessonSourceUsed | null }
  | { outcome: 'failed'; detail: string };

const SYSTEM = `You write one lesson in a learning feed for one person. The lesson teaches one concept from a track they are following. The concept is a claim that can be stated in a sentence and tested.

You are given the track, the unit the concept sits in when there is one, the concepts it builds on, the checks that show someone understands it, and sometimes a section from a reference source close to the claim.

1. Decide whether you can teach the claim from what you know. Say you cannot when it is false, when it is too vague to test, or when you do not know enough to support it without guessing.

2. When a source section is given, read it and say which of three it is. "supports": it is about this claim and agrees with it, or gives facts it rests on. "contradicts": it is about this claim and says the opposite, or gives facts that show the claim is wrong. "unrelated": it is about something else, or only mentions the subject in passing. A source that is only about a neighbouring subject is unrelated. Give one sentence on what it says about the claim.

3. Write the lesson. The person reads its parts in this order and must be able to follow it without the source.

claim: The concept's claim as one plain sentence, keeping its meaning: the thing to remember if they read nothing else. Everyday words, no jargon, no names the reader would have to look up.

context: Two or three sentences giving only what this claim needs to be followed: the terms it uses and the one or two facts it rests on. They already know the concepts it builds on, so name those where they help and do not explain them again. Do not introduce any person, organisation, place or term that the other parts do not use.

evidence: One or two sentences with concrete support: a number, a named case, a measured result. Take it from the source when the source supports the claim and has one. Otherwise use only what is well established. Never a definition.

why: Two or three sentences on why the claim holds: the mechanism or reasoning.

example: Two to four sentences applying the idea to one specific situation: a real event, firm, experiment or policy, or a worked calculation with numbers. Only what is well established; name the case and do not invent figures you are unsure of. If the idea has an obvious everyday application, prefer a less obvious one.

question and answer: One question that makes the person use this idea on a situation, predict an outcome, or explain why something happens. When checks are given, ask for one of them. Never ask them to recall a definition, a figure or a date. The answer is two or three sentences, and says why.

Style for every part: plain sentences. No slogans, no rhetorical questions outside the question field, no "not X, but Y" contrasts, no dashes used for rhythm. Never refer to "the source", "the section", "the text", "the track" or "the lesson". Do not address the reader as "you" outside the question.

Report through ${TOOL_NAME}.`;

const payloadSchema = z.object({
  can_teach: z.boolean(),
  fit: z.string().nullable().optional(),
  source_verdict: z.enum(['supports', 'contradicts', 'unrelated', 'none']).nullable().optional(),
  source_note: z.string().nullable().optional(),
  claim: z.string().nullable().optional(),
  context: z.string().nullable().optional(),
  evidence: z.string().nullable().optional(),
  why: z.string().nullable().optional(),
  example: z.string().nullable().optional(),
  question: z.string().nullable().optional(),
  answer: z.string().nullable().optional(),
});

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

/**
 * Read the tool payload.
 *
 * Pure, and exported for the test. `hasSource` says whether a source was sent:
 * a verdict on a source that was never sent is ignored, and a missing verdict
 * on one that was is read as unrelated, so the lesson never cites a section the
 * model did not vouch for. A contradiction drops the lesson before its parts
 * are read, since it is not served whatever they say.
 */
export function readLessonReport(input: unknown, hasSource: boolean): LessonReport {
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success)
    return { verdict: 'dropped', reason: 'The report did not match its schema.', contradicted: false };
  const data = parsed.data;

  const note = clean(data.source_note).slice(0, MAX_SOURCE_NOTE_CHARS);
  const sourceVerdict: SourceVerdict | null = !hasSource
    ? null
    : data.source_verdict === 'supports' || data.source_verdict === 'contradicts'
      ? data.source_verdict
      : 'unrelated';

  if (sourceVerdict === 'contradicts') {
    return {
      verdict: 'dropped',
      reason: note || 'The source contradicts the claim.',
      contradicted: true,
    };
  }
  if (!data.can_teach) {
    return {
      verdict: 'dropped',
      reason: clean(data.fit) || 'The claim could not be taught from what the model knows.',
      contradicted: false,
    };
  }

  const takeaway = clean(data.claim);
  const context = clean(data.context);
  const hook = clean(data.evidence);
  const summary = clean(data.why);
  const example = clean(data.example);
  const problem =
    badPart('claim', takeaway, MAX_TAKEAWAY_CHARS) ??
    badPart('context', context, MAX_CONTEXT_CHARS) ??
    badPart('evidence', hook, MAX_HOOK_CHARS) ??
    badPart('reason why', summary, MAX_SUMMARY_CHARS) ??
    badPart('example', example, MAX_EXAMPLE_CHARS);
  if (problem)
    return { verdict: 'dropped', reason: `The lesson was not usable: ${problem}.`, contradicted: false };

  const question = clean(data.question);
  const answer = clean(data.answer);
  const asked =
    question && answer && question.length <= MAX_QUESTION_CHARS && answer.length <= MAX_ANSWER_CHARS;

  return {
    verdict: 'ready',
    card: {
      takeaway,
      context,
      hook,
      summary,
      example,
      question: asked ? question : null,
      answer: asked ? answer : null,
    },
    source: sourceVerdict ? { verdict: sourceVerdict, note } : null,
  };
}

/** The user message. Exported for the test. */
export function lessonPrompt(lesson: LessonToWrite): string {
  const { concept, source } = lesson;
  const checks = (concept.mastery ?? []).map(clean).filter(Boolean).slice(0, MAX_CHECKS);
  const prerequisites = (lesson.prerequisites ?? []).map(clean).filter(Boolean).slice(0, MAX_PREREQUISITES);
  const unit = lesson.unit
    ? `Unit: ${clean(lesson.unit.title)}` +
      (lesson.unit.outcome && clean(lesson.unit.outcome) ? `. By its end they should be able to: ${clean(lesson.unit.outcome)}` : '')
    : '';
  const text = source?.text.trim() ?? '';
  const cut = text.length > MAX_SOURCE_CHARS;

  return [
    `Track: ${clean(lesson.trackName)}`,
    unit,
    '',
    `Concept: ${clean(concept.name)}`,
    `Claim: ${clean(concept.claim)}`,
    checks.length > 0
      ? `Checks that show someone understands it:\n${checks.map((check) => `- ${check}`).join('\n')}`
      : '',
    '',
    prerequisites.length > 0
      ? `It builds on these, which they already know:\n${prerequisites.map((name) => `- ${name}`).join('\n')}`
      : 'It builds on nothing they have been taught here.',
    '',
    source
      ? [
          `A reference section close to the claim, from "${source.itemTitle}"` +
            (source.heading ? `, section "${source.heading}".` : '.'),
          cut ? `It is long; these are its first ${MAX_SOURCE_CHARS} characters.` : '',
          '<source>',
          cut ? text.slice(0, MAX_SOURCE_CHARS) : text,
          '</source>',
        ]
          .filter(Boolean)
          .join('\n')
      : 'No reference section is close to this claim. Write from what you know, and leave source_verdict as none.',
    '',
    `Call ${TOOL_NAME}.`,
  ]
    .filter((line, index, lines) => line !== '' || (index > 0 && lines[index - 1] !== ''))
    .join('\n');
}

function sourceUsed(source: LessonSource): LessonSourceUsed {
  return { segmentId: source.segmentId, itemTitle: source.itemTitle, heading: source.heading };
}

const part = (description: string) => ({ type: ['string', 'null'], description });

export async function writeLesson(input: {
  lesson: LessonToWrite;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<LessonResult> {
  const { lesson } = input;
  const name = clean(lesson.concept.name);
  if (!name || !clean(lesson.concept.claim))
    return { outcome: 'dropped', reason: 'The concept has no name or no claim.', contradicted: false, source: null };

  // A source with no text is no source.
  const source = lesson.source && lesson.source.text.trim() ? lesson.source : null;
  const prepared: LessonToWrite = { ...lesson, source };

  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  let response;
  try {
    response = await client.messages.create({
      model: WRITE_LESSON_MODEL,
      max_tokens: 3072,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report whether the claim can be taught, what the source says about it, and the lesson.',
          input_schema: {
            type: 'object',
            properties: {
              can_teach: { type: 'boolean' },
              fit: {
                type: 'string',
                description: 'One sentence on whether the claim can be taught from what you know, and why not when it cannot.',
              },
              source_verdict: {
                type: 'string',
                enum: ['supports', 'contradicts', 'unrelated', 'none'],
                description: 'What the source section is to the claim. None when no source was given.',
              },
              source_note: part('One sentence on what the source says about the claim. Null when no source was given.'),
              claim: part('The claim as one plain sentence.'),
              context: part('Only the terms and facts this claim needs, in two or three sentences.'),
              evidence: part('Concrete support: a number, a case or a result.'),
              why: part('Why the claim holds, in two or three sentences.'),
              example: part('The idea applied to one specific case or a worked number.'),
              question: part('One question that makes them use the idea.'),
              answer: part('The answer, with why, in two or three sentences.'),
            },
            required: [
              'can_teach',
              'fit',
              'source_verdict',
              'source_note',
              'claim',
              'context',
              'evidence',
              'why',
              'example',
              'question',
              'answer',
            ],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME),
      messages: [{ role: 'user', content: lessonPrompt(prepared) }],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return { outcome: 'failed', detail: 'Rate limited.' };
    return {
      outcome: 'failed',
      detail: error instanceof Error ? error.message : 'The lesson call failed.',
    };
  }

  // Before the reply is read: a malformed report still cost what it cost.
  input.onSpend?.({ model: WRITE_LESSON_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((piece) => piece.type === 'tool_use' && piece.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use')
    return { outcome: 'dropped', reason: whyNoReport(response), contradicted: false, source: null };

  const report = readLessonReport(block.input, source !== null);
  if (report.verdict === 'dropped') {
    return {
      outcome: 'dropped',
      reason: report.reason,
      contradicted: report.contradicted,
      source: report.contradicted && source ? sourceUsed(source) : null,
    };
  }
  return {
    outcome: 'ready',
    card: { name, ...report.card },
    source: source && report.source?.verdict === 'supports' ? sourceUsed(source) : null,
  };
}
