import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { fetchDocument } from '@/lib/learn/providers';
import { buildTextFragmentUrl, containsAnchor, toPlainText } from '@/lib/learn/locate/html';

/**
 * Finding the paragraph, when you open the reading and not before.
 *
 * Lazy on purpose. You will not read most of what you queue, and fetching a
 * 62-page paper to find a passage nobody asked for is money spent on optimism.
 * Doing it on open means the cost tracks what you study rather than what you
 * filed, and a track of twenty readings costs nothing until you start it.
 *
 * The rule this obeys is the module's first: a phrase the model returns is
 * checked against the document it claims to come from, verbatim, before the
 * locator is called verified. A phrase that is not there was invented, and a
 * link that highlights nothing is worse than a link to the top of the page --
 * you spend the twenty minutes anyway and you stop trusting the queue.
 */

const MODEL = 'claude-haiku-4-5-20251001';
const TOOL_NAME = 'report_passage';

/** Enough of a document to find a passage in; past this it is a book. */
const MAX_TEXT_CHARS = 180_000;

const passageSchema = z.object({
  anchor: z.string().trim().min(12).max(300).nullable(),
  label: z.string().trim().max(300).nullable().optional(),
  reason: z.string().trim().max(300).nullable().optional(),
});

const SYSTEM = `You are given the text of a document and a question somebody is
trying to answer. Find the passage in the document that speaks to it.

Return in "anchor" a phrase copied EXACTLY from the document -- character for
character, from one sentence, between about 15 and 200 characters. It is used
to build a link that scrolls the reader to that spot, so a phrase that differs
from the document by even a word will land them nowhere.

Do not paraphrase. Do not tidy the punctuation. Do not join text from two
places. Copy.

Pick the sentence where the document actually makes the point, not the sentence
that introduces the section.

If nothing in this document addresses the question, or the document is short
enough that pointing at one sentence would be silly, set anchor to null.

"label" is a short human description of where this is, if the document makes
one obvious -- a section heading, for instance. Otherwise null.`;

export type LocateOutcome = {
  openUrl: string;
  textAnchor: string | null;
  locatorKind?: 'passage';
  locatorLabel?: string | null;
  confidence: 'verified' | 'unverified';
  basis: string;
};

/**
 * Try to narrow a reading to a passage.
 *
 * Never throws and never returns nothing: the worst case is the URL you
 * already had with a basis explaining why it could not be narrowed, which is
 * exactly what the reader should see rather than an error page. Every failure
 * mode here is ordinary -- a paywall, a PDF, a page that moved.
 */
export async function locatePassage(input: {
  url: string;
  question: string | null;
  anthropicApiKey?: string | null;
  client?: Anthropic;
}): Promise<LocateOutcome> {
  const unchanged = (basis: string): LocateOutcome => ({
    openUrl: input.url,
    textAnchor: null,
    confidence: 'unverified',
    basis,
  });

  const fetched = await fetchDocument(input.url);

  if (!fetched.ok) {
    switch (fetched.reason) {
      case 'not-found':
        return unchanged('The page could not be found when this was checked.');
      case 'unsupported-type':
        return unchanged('Not a document this can read; opens as it is.');
      case 'too-large':
        return unchanged('Too large to scan for a passage; opens at the top.');
      case 'timeout':
        return unchanged('The source did not respond in time; opens at the top.');
      case 'blocked':
        return unchanged('This address was refused; opens as it is.');
      default:
        return unchanged('Could not be read from here -- often a paywall or a login.');
    }
  }

  if (fetched.contentType === 'pdf') {
    // Page-level pointers for PDFs are a separate slice: it needs a text
    // extraction library, and a page number guessed without one would be a
    // confident wrong answer, which is the thing this module refuses to give.
    return unchanged('A PDF. Opens at the first page; passages are not located in PDFs yet.');
  }

  const text = toPlainText(fetched.text).slice(0, MAX_TEXT_CHARS);
  if (text.length < 400) {
    return unchanged('Short enough to read from the top.');
  }

  if (!input.anthropicApiKey && !input.client) {
    return unchanged('Fetched, but passage-finding needs an API key; opens at the top.');
  }

  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey! });

  let parsed: z.infer<typeof passageSchema>;
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the passage that answers the question.',
          input_schema: {
            type: 'object',
            properties: {
              anchor: { type: ['string', 'null'] },
              label: { type: ['string', 'null'] },
              reason: { type: ['string', 'null'] },
            },
            required: ['anchor'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [
        {
          role: 'user',
          content: [
            input.question ? `Question: ${input.question}` : 'No specific question was given.',
            '',
            'Document:',
            text,
          ].join('\n'),
        },
      ],
    });

    const block = response.content.find((c) => c.type === 'tool_use');
    if (!block || block.type !== 'tool_use') {
      return unchanged('Fetched, but no passage was reported; opens at the top.');
    }

    const safe = passageSchema.safeParse(block.input);
    if (!safe.success) {
      return unchanged('Fetched, but the passage came back malformed; opens at the top.');
    }
    parsed = safe.data;
  } catch {
    return unchanged('Fetched, but finding a passage failed; opens at the top.');
  }

  if (!parsed.anchor) {
    return {
      openUrl: fetched.url,
      textAnchor: null,
      confidence: 'verified',
      basis: 'Fetched and read; no single passage stood out, so this opens at the top.',
    };
  }

  // The check the whole module rests on. A phrase not present in the document
  // was invented, and shipping it would produce a link that highlights nothing.
  if (!containsAnchor(text, parsed.anchor)) {
    return {
      openUrl: fetched.url,
      textAnchor: null,
      confidence: 'unverified',
      basis:
        'A passage was proposed but did not appear in the fetched page, so it was discarded. ' +
        'Opens at the top.',
    };
  }

  return {
    openUrl: buildTextFragmentUrl(fetched.url, parsed.anchor),
    textAnchor: parsed.anchor,
    locatorKind: 'passage',
    locatorLabel: parsed.label?.trim() || null,
    confidence: 'verified',
    basis: 'Found verbatim in the fetched page; the link opens at that passage.',
  };
}
