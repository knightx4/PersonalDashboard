import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  resolvedSourceSchema,
  sanitiseResolution,
  type ResolvedSource,
} from '@/lib/learn/import/resolve-payload';

/**
 * Finding something to read about a subject you wrote down.
 *
 * A different question from the one lib/learn/import/resolve.ts asks. That one
 * is given a citation -- a work somebody already named -- and finds where it
 * can be read. This one is given only a subject, in your words, and has to
 * decide what is worth reading about it at all.
 *
 * The harder half is restraint. Asked "what should I read about central
 * banking", a model will happily produce ten things, most of them plausible
 * and forgettable. Four good ones beat ten, and the prompt says so, because
 * the whole premise of this module is that the reader is drowning in
 * plausible options rather than short of them.
 */

const MODEL = 'claude-opus-5';
const MAX_SEARCHES = 8;
const TOOL_NAME = 'report_sources';

export const MAX_SUGGESTIONS = 4;

const suggestionsSchema = z.object({
  sources: z.array(resolvedSourceSchema).max(12),
  /** Said out loud when the subject is too vague to search well. */
  too_vague: z.boolean().default(false),
});

const SYSTEM = `You are given a subject somebody wants to learn about, in their own
words, and usually the larger question behind it. Find the best few things to
read.

FEW. At most four, and fewer is better. Two excellent sources beat six decent
ones -- the person asking is not short of plausible options, they are drowning
in them, and every extra row costs them a decision. If one thing genuinely
covers it, return one.

WHAT COUNTS
Prefer, in this order: a primary source or the canonical treatment, a
well-regarded explainer by somebody who actually knows the field, an
institution's own explanation of its own workings. A free full text beats a
paywalled one; a paywalled canonical source beats a free bad one.

Never return: "book summary" sites, content farms, SEO listicles, essay mills,
scraped copies, or a page whose purpose is to sell a course. If all you can
find is that, return no sources at all rather than filling the list.

ORDER THEM so each assumes only what the one before it taught. Put the thing
that gives the ground first, not the most famous thing.

FOR EACH ONE
- Set access honestly: open, paywalled, purchase, library, or unknown. Give
  price_cents only if you actually saw a price.
- locator_kind is "whole" for an essay or a short paper. For a book, name the
  chapter that speaks to THIS subject -- not the most famous chapter -- as
  locator_kind "chapter" with a locator_label like 'Ch. 4, "Money and
  Commodities"'.
- locator_basis says HOW you know where to look, in one short sentence. It is
  shown to the reader, so never imply you checked something you did not:
  "The table of contents on the publisher's page lists this chapter" and
  "Widely cited as the chapter making this argument; not confirmed against a
  table of contents" are different claims.
- why says what this one gives that the previous one did not. One line. Not a
  summary of the source.

IF THE SUBJECT IS TOO VAGUE to search usefully -- "business", "history" -- set
too_vague true and return no sources. Guessing at what somebody meant and
handing back a reading list for it wastes more of their time than saying so.`;

export type SuggestResult =
  | { ok: true; sources: ResolvedSource[] }
  | { ok: false; reason: 'too-vague' | 'nothing-good' | 'error'; detail: string };

function buildPrompt(subject: string, question: string | null): string {
  const lines = [`Subject: ${subject}`];
  if (question) {
    lines.push('', `The larger question they are working on: ${question}`);
    lines.push('Aim these at that, not at the subject in general.');
  }
  lines.push('', `Search, then call ${TOOL_NAME}.`);
  return lines.join('\n');
}

/**
 * Suggest things to read about a subject.
 *
 * Never throws. Every failure is ordinary -- a rate limit, a subject too vague
 * to search, an internet with nothing good on it -- and each one is worth a
 * different sentence on the screen.
 */
export async function suggestSources(input: {
  subject: string;
  question?: string | null;
  anthropicApiKey: string;
  client?: Anthropic;
}): Promise<SuggestResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM,
      tools: [
        {
          type: 'web_search_20260209',
          name: 'web_search',
          max_uses: MAX_SEARCHES,
        } as unknown as Anthropic.Tool,
        {
          name: TOOL_NAME,
          description: 'Report the few things worth reading about this subject.',
          input_schema: {
            type: 'object',
            properties: {
              too_vague: { type: 'boolean' },
              sources: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
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
                  },
                  required: ['title', 'locator_basis'],
                },
              },
            },
            required: ['sources'],
          },
        },
      ],
      messages: [{ role: 'user', content: buildPrompt(input.subject, input.question ?? null) }],
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

  const safe = suggestionsSchema.safeParse(block.input);
  if (!safe.success) {
    return { ok: false, reason: 'error', detail: 'The results came back malformed.' };
  }

  if (safe.data.too_vague) {
    return {
      ok: false,
      reason: 'too-vague',
      detail: 'Too broad to search usefully. Try naming what about it you want to understand.',
    };
  }

  const sources = safe.data.sources
    .map(sanitiseResolution)
    // A source with nowhere to read it is still useful when it is a book you
    // could buy -- but one the model itself gave up on is not.
    .filter((source) => !source.not_found)
    .slice(0, MAX_SUGGESTIONS);

  if (sources.length === 0) {
    return {
      ok: false,
      reason: 'nothing-good',
      detail: 'Nothing worth reading turned up. Better to find none than to send you to junk.',
    };
  }

  return { ok: true, sources };
}
