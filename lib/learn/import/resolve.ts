import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import type { ReferenceCandidate } from '@/lib/learn/import/parse-heuristic';
import {
  isEmptyResolution,
  resolvedSourceSchema,
  sanitiseResolution,
  type ResolvedSource,
} from '@/lib/learn/import/resolve-payload';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';

/**
 * Turning a citation into something you can open.
 *
 * This is the step the module exists for. "Dworkin's 'Equality of Resources'"
 * is a name; what you need is a URL, whether it is free, and which thirty
 * pages of it answer the question you asked. Doing that by hand is twenty
 * minutes for five references, which is the reason the reading list gets
 * copied into a note and never opened.
 *
 * Opus rather than Haiku: this is judgment, not lookup. Deciding that a hit is
 * the real paper rather than a course page that cites it, that a "book summary"
 * site is not a source, and which chapter of a 350-page book speaks to a
 * particular confusion -- none of that is retrieval. Same call the evidence
 * proposer makes in lib/jobs/evidence/propose.ts.
 */

const MODEL = 'claude-opus-5';
// Four, not six. Each search is a round trip inside one already-slow call,
// and the sixth rarely changes the answer -- it is usually the model
// double-checking a URL it already had. Fewer searches is the single cheapest
// thing that makes an import feel finished sooner.
const MAX_SEARCHES = 4;
const TOOL_NAME = 'report_source';

const SYSTEM = `You find where a recommended work can actually be read, and which
part of it to read.

You are given one citation, and usually the question the reader is trying to
answer. Search, then report what you found.

WHERE TO READ IT
Prefer, in this order: the publisher's own page, a university or institutional
repository, the author's own site, an established archive. A free full text
beats a paywalled one; a paywalled canonical source beats a free bad one.

Never return: "book summary" sites, content farms, SEO listicles, essay mills,
scraped copies, or a page whose purpose is to sell a course. If the only thing
you can find is one of those, report not_found instead. A missing link is a
better answer than a link to junk -- the reader can still buy the book.

Set access honestly:
- open: free full text, no account
- paywalled: readable for a fee per article. Give price_cents if you saw it
- purchase: a book you would buy. Give price_cents if you saw it
- library: free with a library card or institutional login
- unknown: you could not establish it. Not a synonym for open

WHICH PART TO READ
This matters as much as the link. A 350-page book is not something anyone will
read on a recommendation; chapter 4 of it might be.

- For something short -- an essay, a paper under about 40 pages -- locator_kind
  is "whole". Do not invent a section to look precise.
- For a book, name the chapter: locator_kind "chapter", locator_label like
  'Ch. 4, "Money and Commodities"'. Give page_from and page_to only if you
  actually saw them.
- Aim the choice at the reader's question when you were given one. The right
  chapter is the one that speaks to what they are stuck on, not the one that is
  most famous.

locator_basis says HOW you know, in one short sentence, and it is shown to the
reader. Be exact about the difference between these:
- "The table of contents on the publisher's page lists this chapter."
- "Widely cited as the chapter making this argument; not confirmed against a
  table of contents."
- "Short essay, read it in full."
Never write a basis that implies you checked something you did not check.

If you cannot find the work at all, set not_found true and say why in
locator_basis. Do not return a guess dressed as a find.`;

export type ResolutionRow = {
  candidate: ReferenceCandidate;
  resolved: ResolvedSource | null;
  error?: string;
};

function buildPrompt(candidate: ReferenceCandidate, question: string | null): string {
  const lines = [`Citation: ${candidate.title}`];
  if (candidate.author) lines.push(`Author, as given: ${candidate.author}`);
  if (candidate.url) lines.push(`A URL came with it: ${candidate.url}`);
  if (candidate.why) lines.push(`Why it was recommended: ${candidate.why}`);
  if (question) {
    lines.push('', `The reader is trying to work out: ${question}`);
    lines.push('Aim the location at that.');
  }
  lines.push('', `Search, then call ${TOOL_NAME}.`);
  return lines.join('\n');
}

async function resolveOne(
  client: Anthropic,
  candidate: ReferenceCandidate,
  question: string | null,
  onSpend?: SpendSink,
): Promise<ResolvedSource> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM,
    tools: [
      // Server-side web search: Anthropic runs it, results come back inline.
      // Same shape lib/sell/web-estimate.ts already uses.
      {
        type: 'web_search_20260209',
        name: 'web_search',
        max_uses: MAX_SEARCHES,
      } as unknown as Anthropic.Tool,
      {
        name: TOOL_NAME,
        description: 'Report where this work can be read and which part to read.',
        input_schema: {
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
            locator_verified: { type: 'boolean' },
            why: { type: ['string', 'null'] },
            not_found: { type: 'boolean' },
          },
          required: ['title', 'locator_basis'],
        },
      },
    ],
    messages: [{ role: 'user', content: buildPrompt(candidate, question) }],
  });

  // Reported before the response is judged: a citation that could not be
  // placed cost the same search as one that could.
  onSpend?.({ model: MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') {
    throw new Error('the model searched but never reported a source');
  }

  const safe = resolvedSourceSchema.safeParse(block.input);
  if (!safe.success) {
    throw new Error(`the report did not match the schema: ${safe.error.issues[0]?.message}`);
  }

  return sanitiseResolution(safe.data);
}

/**
 * Resolve exactly one citation.
 *
 * One per request, called from the import screen so each answer paints as it
 * lands rather than the whole list waiting on the slowest. It also keeps every
 * request short, which matters on a platform that eventually stops one: a
 * single call resolving eight citations end to end is one long request, and
 * when it is cut off you lose all eight.
 *
 * Never throws. A citation that cannot be placed comes back carrying its
 * reason, because one line on the screen saying so is what stops you assuming
 * the list was complete.
 */
export async function resolveOneReference(
  candidate: ReferenceCandidate,
  options: {
    anthropicApiKey: string;
    question?: string | null;
    client?: Anthropic;
    /** Told what the call cost, whether or not the citation could be placed. */
    onSpend?: SpendSink;
  },
): Promise<ResolutionRow> {
  const client = options.client ?? new Anthropic({ apiKey: options.anthropicApiKey });

  try {
    const resolved = await resolveOne(
      client,
      candidate,
      options.question?.trim() || null,
      options.onSpend,
    );
    if (isEmptyResolution(resolved)) {
      return { candidate, resolved, error: resolved.locator_basis || 'Could not find this one.' };
    }
    return { candidate, resolved };
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { candidate, resolved: null, error: 'Rate limited. Try this one again shortly.' };
    }
    return {
      candidate,
      resolved: null,
      error: error instanceof Error ? error.message : 'Resolve failed',
    };
  }
}
