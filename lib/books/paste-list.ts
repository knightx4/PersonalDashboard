/**
 * Parse a pasted free-text book list into candidates, then resolve each.
 * LLM path when ANTHROPIC_API_KEY is set; otherwise line-heuristic.
 */
import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { extractIsbnFromText } from '@/lib/books/isbn';
import { resolveBook } from '@/lib/books/resolve';
import type { CanonicalBook, ResolveBookInput } from '@/lib/books/types';
import { mapPool } from '@/lib/async/map-pool';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import {
  heuristicParseLines,
  type PasteCandidate,
} from '@/lib/books/paste-list-heuristic';

export type { PasteCandidate };

const PASTE_MODEL = 'claude-haiku-4-5-20251001';

export const pasteLineSchema = z.object({
  title: z.string().trim().min(1).optional(),
  author: z.string().trim().nullable().optional(),
  isbn: z.string().trim().nullable().optional(),
});

export const pasteListSchema = z.object({
  lines: z.array(pasteLineSchema).max(80),
});

export type ResolvedPasteRow = {
  raw: string;
  book: CanonicalBook | null;
  error?: string;
};

async function llmParseLines(
  text: string,
  apiKey: string,
  onSpend?: SpendSink,
): Promise<PasteCandidate[]> {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: PASTE_MODEL,
    max_tokens: 2048,
    system: `You parse a pasted list of owned books into structured lines.
Return ONLY JSON: {"lines":[{"title":"...","author":"...|null","isbn":"...|null"}]}
Rules:
- One object per book.
- Prefer ISBN when present (digits only or hyphenated).
- title is required when isbn is absent.
- Do not invent books that are not in the text.`,
    messages: [{ role: 'user', content: text.slice(0, 12_000) }],
  });
  onSpend?.({ model: PASTE_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'text');
  if (!block || block.type !== 'text') return heuristicParseLines(text);

  const jsonMatch = block.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return heuristicParseLines(text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return heuristicParseLines(text);
  }

  const safe = pasteListSchema.safeParse(parsed);
  if (!safe.success) return heuristicParseLines(text);

  return safe.data.lines
    .map((line) => {
      const isbn = line.isbn ? extractIsbnFromText(line.isbn) : null;
      if (isbn) {
        return { raw: line.isbn ?? isbn, input: { isbn } as ResolveBookInput };
      }
      if (!line.title) return null;
      return {
        raw: [line.title, line.author].filter(Boolean).join(' — '),
        input: { title: line.title, author: line.author ?? null } as ResolveBookInput,
      };
    })
    .filter((c): c is PasteCandidate => c !== null);
}

export async function parsePasteList(
  text: string,
  options: {
    anthropicApiKey?: string | null;
    /** What the call cost; record it as 'parse-paste-list'. */
    onSpend?: SpendSink;
  } = {},
): Promise<PasteCandidate[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (options.anthropicApiKey) {
    try {
      return await llmParseLines(trimmed, options.anthropicApiKey, options.onSpend);
    } catch {
      return heuristicParseLines(trimmed);
    }
  }
  return heuristicParseLines(trimmed);
}

export async function resolvePasteList(
  text: string,
  options: {
    anthropicApiKey?: string | null;
    googleBooksApiKey?: string | null;
    concurrency?: number;
    /** What the parse cost; record it as 'parse-paste-list'. */
    onSpend?: SpendSink;
  } = {},
): Promise<ResolvedPasteRow[]> {
  const candidates = await parsePasteList(text, {
    anthropicApiKey: options.anthropicApiKey,
    onSpend: options.onSpend,
  });
  return mapPool(candidates, options.concurrency ?? 3, async (candidate) => {
    try {
      const book = await resolveBook(candidate.input, {
        googleBooksApiKey: options.googleBooksApiKey,
      });
      return { raw: candidate.raw, book };
    } catch (err) {
      return {
        raw: candidate.raw,
        book: null,
        error: err instanceof Error ? err.message : 'Resolve failed',
      };
    }
  });
}
