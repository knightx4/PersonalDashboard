import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  heuristicParseReferences,
  type ReferenceCandidate,
} from '@/lib/learn/import/parse-heuristic';

/**
 * Reading a pasted list into references, and nothing more.
 *
 * The parse deliberately does not search. It reads what is in front of it and
 * stops, which keeps the cheap step cheap and makes the expensive one --
 * resolution, one web-searching call per reference -- retryable a row at a
 * time. Doing both in one call means a single bad row costs the whole import.
 *
 * Haiku, because this is transcription rather than judgment: the text already
 * names the works, and the job is to split them apart and say which part is
 * the citation and which is the recommender's commentary. Same division
 * lib/books/paste-list.ts already makes for a pasted list of owned books, and
 * the same fallback: with no API key the heuristic runs instead, so the module
 * is developable without one.
 */

const MODEL = 'claude-haiku-4-5-20251001';

/** Past this a paste is a document, not a list. */
const MAX_INPUT_CHARS = 24_000;
export const MAX_REFERENCES = 40;

const referenceSchema = z.object({
  title: z.string().trim().min(1),
  author: z.string().trim().nullable().optional(),
  url: z.string().trim().url().nullable().optional(),
  why: z.string().trim().nullable().optional(),
  raw: z.string().trim().nullable().optional(),
});

export const parseResultSchema = z.object({
  references: z.array(referenceSchema).max(MAX_REFERENCES),
});

const SYSTEM = `You read a pasted reading list and split it into the works it names.

The paste is usually a reply somebody got from a chat assistant, or a syllabus,
or a set of footnotes. Each entry names one work and is generally wrapped in a
sentence saying why it is worth reading.

For each work, return:
- title: the work itself, with no commentary attached. If the entry names both
  a book and an essay inside it, prefer whichever the recommender pointed at.
- author: as written, or null. Never guess an author you were not given.
- url: only if one is present in the text. Never invent one.
- why: the recommender's own reason, close to verbatim, or null. This is worth
  keeping -- it says why this source speaks to the question that was asked, and
  it is better than anything generated later.

Rules:
- One entry per work. A line that mentions a second work in passing ("Sandel's
  What Money Can't Buy is the popular version") is a second entry.
- Do not invent works that are not in the text.
- Do not include headings, greetings, or lines that introduce the list.
- If the paste names no works at all, return an empty array.`;

const TOOL_NAME = 'report_references';

function toCandidates(parsed: z.infer<typeof parseResultSchema>): ReferenceCandidate[] {
  return parsed.references.map((ref) => ({
    raw: ref.raw?.trim() || [ref.author, ref.title].filter(Boolean).join(', '),
    title: ref.title,
    author: ref.author?.trim() || null,
    url: ref.url?.trim() || null,
    why: ref.why?.trim() || null,
  }));
}

async function llmParse(text: string, apiKey: string): Promise<ReferenceCandidate[]> {
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM,
    tools: [
      {
        name: TOOL_NAME,
        description: 'Report the works this paste names.',
        input_schema: {
          type: 'object',
          properties: {
            references: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  author: { type: ['string', 'null'] },
                  url: { type: ['string', 'null'] },
                  why: { type: ['string', 'null'] },
                  raw: { type: ['string', 'null'] },
                },
                required: ['title'],
              },
            },
          },
          required: ['references'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{ role: 'user', content: text.slice(0, MAX_INPUT_CHARS) }],
  });

  const block = response.content.find((c) => c.type === 'tool_use');
  if (!block || block.type !== 'tool_use') throw new Error('no tool call');

  const safe = parseResultSchema.safeParse(block.input);
  if (!safe.success) throw new Error('tool call did not match the schema');

  return toCandidates(safe.data);
}

/**
 * Parse a paste into references.
 *
 * Falls back to the line heuristic on any failure -- no key, a refused call, a
 * malformed tool call. An import that half-works is worth more than one that
 * throws, because the confirm screen is going to show you what it found either
 * way and a bad row costs one untick.
 */
export async function parseReferences(
  text: string,
  options: { anthropicApiKey?: string | null } = {},
): Promise<ReferenceCandidate[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];

  if (options.anthropicApiKey) {
    try {
      const parsed = await llmParse(trimmed, options.anthropicApiKey);
      // An empty result from a paste that clearly has lines in it means the
      // call went wrong in a way that did not throw. The heuristic is a better
      // answer than nothing.
      if (parsed.length > 0) return parsed.slice(0, MAX_REFERENCES);
    } catch {
      // Fall through.
    }
  }

  return heuristicParseReferences(trimmed).slice(0, MAX_REFERENCES);
}

export type { ReferenceCandidate };
