import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import {
  normalisePlan,
  planPayloadSchema,
  stepsWithSource,
  type PlanStep,
} from '@/lib/learn/import/plan-payload';

/**
 * Turning a topic you named into a route through it.
 *
 * The third question this module asks a model. resolve.ts is given a citation
 * and finds where it can be read. suggest.ts is given one subject and finds
 * what is worth reading about it. This one is given only the topic -- the
 * thing you typed on /learn/new and nothing else -- and has to decide what the
 * parts of it even are before any of them can be sourced.
 *
 * That is the weak half, and the spec says so: generation is expensive,
 * gap-prone and quietly incomplete. The prompt is therefore written against
 * completeness rather than for it. A plan that names six steps and sources
 * four is a good answer; the same plan with the two unsourced steps deleted is
 * a worse one pretending to be better, because you cannot tell what is missing
 * from a list that looks finished.
 */

const MODEL = 'claude-opus-5';
const MAX_SEARCHES = 12;
const TOOL_NAME = 'report_plan';

const SYSTEM = `You are given a topic somebody wants to learn, in their own words, and
usually the larger question behind it. Lay out the route through it: the few
things they have to understand, in the order that makes each one possible, and
where each can be read.

FEW STEPS. Three to six. Never more than eight. This is the shortest route
through the topic, not a syllabus -- every extra step is one more thing between
them and understanding the thing they actually asked about. If the topic is
genuinely small, two steps is a fine answer.

EACH STEP is a subject in their terms, not a source title: "why a bank needs
reserves at all", not "Chapter 3 of Goodhart". Order them so each assumes only
what the ones before it taught. Put the thing that gives the ground first, even
when it is duller than the famous thing.

THEN SOURCE EACH ONE, by searching. Prefer, in this order: a primary source or
the canonical treatment, a well-regarded explainer by somebody who actually
knows the field, an institution's own explanation of its own workings. A free
full text beats a paywalled one; a paywalled canonical source beats a free bad
one. Never return "book summary" sites, content farms, SEO listicles, essay
mills, scraped copies, or a page whose purpose is to sell a course.

WHEN YOU CANNOT SOURCE A STEP, KEEP THE STEP. Leave source null and write
no_source_reason saying what you actually hit: nothing written at this level,
everything behind a paywall, only course-sales pages, a literature you could
not search from here. This matters more than any other instruction here. A plan
missing a step it never mentioned is worse than useless -- it reads as the
whole route and is not, and they have no way to know. Do not invent a plausible
source to fill a step, do not merge a step you could not source into its
neighbour, and do not quietly drop it.

FOR EACH SOURCE
- Set access honestly: open, paywalled, purchase, library, or unknown. Give
  price_cents only if you actually saw a price.
- locator_kind is "whole" for an essay or a short paper. For a book, name the
  chapter that speaks to THIS step -- not the most famous chapter -- as
  locator_kind "chapter" with a locator_label like 'Ch. 4, "Money and
  Commodities"'.
- locator_basis says HOW you know where to look, in one short sentence. It is
  shown to the reader, so never imply you checked something you did not.
- why says what this step gives that the one before it did not. One line.

IF THE TOPIC IS TOO VAGUE to plan -- "business", "history", "science" -- set
too_vague true and return no steps. A route through a topic nobody named is
six plausible steps through the wrong subject.`;

export type PlanResult =
  | { ok: true; steps: PlanStep[] }
  | { ok: false; reason: 'too-vague' | 'nothing-good' | 'error'; detail: string };

function buildPrompt(topic: string, question: string | null): string {
  const lines = [`Topic: ${topic}`];
  if (question) {
    lines.push('', `The larger question they are working on: ${question}`);
    lines.push('Aim the whole route at that, not at the topic in general.');
  }
  lines.push('', `Search as you go, then call ${TOOL_NAME}.`);
  return lines.join('\n');
}

const SOURCE_PROPERTIES = {
  title: { type: 'string' },
  author: { type: ['string', 'null'] },
  kind: {
    type: 'string',
    enum: ['article', 'paper', 'book', 'chapter', 'video', 'course', 'page'],
  },
  year: { type: ['integer', 'null'] },
  canonical_url: { type: ['string', 'null'] },
  access: {
    type: 'string',
    enum: ['open', 'paywalled', 'purchase', 'library', 'unknown'],
  },
  price_cents: { type: ['integer', 'null'] },
  page_count: { type: ['integer', 'null'] },
  locator_kind: {
    type: 'string',
    enum: ['whole', 'chapter', 'section', 'pages', 'timestamp', 'passage'],
  },
  locator_label: { type: ['string', 'null'] },
  page_from: { type: ['integer', 'null'] },
  page_to: { type: ['integer', 'null'] },
  locator_basis: { type: 'string' },
  why: { type: ['string', 'null'] },
} as const;

/**
 * Plan a topic.
 *
 * Never throws. Every failure is ordinary -- a rate limit, a topic too vague
 * to plan, a subject with nothing good written about it -- and each one is
 * worth a different sentence on the screen, because each sends the reader to a
 * different next move.
 */
export async function planTopic(input: {
  topic: string;
  question?: string | null;
  anthropicApiKey: string;
  client?: Anthropic;
}): Promise<PlanResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: SYSTEM,
      tools: [
        {
          type: 'web_search_20260209',
          name: 'web_search',
          max_uses: MAX_SEARCHES,
        } as unknown as Anthropic.Tool,
        {
          name: TOOL_NAME,
          description: 'Report the route through this topic, including the steps you could not source.',
          input_schema: {
            type: 'object',
            properties: {
              too_vague: { type: 'boolean' },
              steps: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    subject: { type: 'string' },
                    why: { type: ['string', 'null'] },
                    no_source_reason: { type: ['string', 'null'] },
                    source: {
                      type: ['object', 'null'],
                      properties: SOURCE_PROPERTIES,
                      required: ['title', 'locator_basis'],
                    },
                  },
                  required: ['subject'],
                },
              },
            },
            required: ['steps'],
          },
        },
      ],
      messages: [{ role: 'user', content: buildPrompt(input.topic, input.question ?? null) }],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, reason: 'error', detail: 'Rate limited. Try again shortly.' };
    }
    return {
      ok: false,
      reason: 'error',
      detail: error instanceof Error ? error.message : 'The search failed.',
    };
  }

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') {
    return { ok: false, reason: 'error', detail: 'The search ran but reported nothing.' };
  }

  const safe = planPayloadSchema.safeParse(block.input);
  if (!safe.success) {
    return { ok: false, reason: 'error', detail: 'The plan came back malformed.' };
  }

  if (safe.data.too_vague) {
    return {
      ok: false,
      reason: 'too-vague',
      detail: 'Too broad to plan usefully. Try naming what about it you want to understand.',
    };
  }

  const steps = normalisePlan(safe.data);

  // A plan of nothing but gaps is not a plan. Saying that plainly beats a
  // screen of empty rows, and it is a different sentence from "too broad":
  // the topic was clear enough, there is just nothing readable behind it.
  if (steps.length === 0 || stepsWithSource(steps).length === 0) {
    return {
      ok: false,
      reason: 'nothing-good',
      detail:
        'Nothing worth reading turned up for any part of this. Better to find none than to send you to junk.',
    };
  }

  return { ok: true, steps };
}
