'use server';

import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { requireUser } from '@/lib/auth/server';
import { extractIsbnFromText } from '@/lib/books/isbn';
import { resolveBook } from '@/lib/books/resolve';
import type { CanonicalBook } from '@/lib/books/types';
import { mapPool } from '@/lib/async/map-pool';
import { serverEnv } from '@/lib/env';
import { parseImageDataUrl } from '@/lib/images/data-url';
import type { BookActionState } from './actions';

const spineSchema = z.object({
  spines: z
    .array(
      z.object({
        title: z.string().trim().min(1).optional(),
        author: z.string().trim().nullable().optional(),
        isbn: z.string().trim().nullable().optional(),
      }),
    )
    .max(40),
});

const coverSchema = z.object({
  isbn: z.string().trim().nullable().optional(),
  title: z.string().trim().nullable().optional(),
  author: z.string().trim().nullable().optional(),
});

function envKeys() {
  try {
    const env = serverEnv();
    return {
      anthropicApiKey: env.ANTHROPIC_API_KEY ?? null,
      googleBooksApiKey: env.GOOGLE_BOOKS_API_KEY ?? null,
    };
  } catch {
    return {
      anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,
      googleBooksApiKey: process.env.GOOGLE_BOOKS_API_KEY ?? null,
    };
  }
}

export async function extractBooksFromPhoto(
  _prev: BookActionState,
  formData: FormData,
): Promise<BookActionState> {
  await requireUser();
  const keys = envKeys();
  if (!keys.anthropicApiKey) {
    return { error: 'Photo capture needs ANTHROPIC_API_KEY on the server.' };
  }

  const kind = String(formData.get('kind') ?? 'shelf');
  const parsedImage = parseImageDataUrl(String(formData.get('image_data_url') ?? ''));
  if (!parsedImage.ok) return { error: parsedImage.error };

  const client = new Anthropic({ apiKey: keys.anthropicApiKey });
  const isCover = kind === 'cover';

  const system = isCover
    ? `You read a book cover or back-cover photo.
Return ONLY JSON: {"isbn":"...|null","title":"...|null","author":"...|null"}
Prefer a visible ISBN barcode/number on the back cover when present.`
    : `You read book spines on a shelf photo.
Return ONLY JSON: {"spines":[{"title":"...","author":"...|null","isbn":"...|null"}]}
One object per visible spine. Skip unreadable spines. Max 40.`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    system,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: parsedImage.mediaType,
              data: parsedImage.data,
            },
          },
          {
            type: 'text',
            text: isCover
              ? 'Extract the book identity from this cover/back photo.'
              : 'List the readable spines in this shelf photo.',
          },
        ],
      },
    ],
  });

  const block = response.content.find((c) => c.type === 'text');
  if (!block || block.type !== 'text') return { error: 'Model returned no text.' };

  const jsonMatch = block.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { error: 'Could not parse photo extraction.' };

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(jsonMatch[0]);
  } catch {
    return { error: 'Could not parse photo extraction JSON.' };
  }

  type Candidate = { title?: string; author?: string | null; isbn?: string | null };
  let candidates: Candidate[] = [];

  if (isCover) {
    const safe = coverSchema.safeParse(rawJson);
    if (!safe.success) return { error: 'Unexpected cover extraction shape.' };
    candidates = [
      {
        title: safe.data.title ?? undefined,
        author: safe.data.author,
        isbn: safe.data.isbn,
      },
    ];
  } else {
    const safe = spineSchema.safeParse(rawJson);
    if (!safe.success) return { error: 'Unexpected shelf extraction shape.' };
    candidates = safe.data.spines.map((s) => ({
      title: s.title,
      author: s.author,
      isbn: s.isbn,
    }));
  }

  const results = await mapPool(candidates, 3, async (candidate) => {
    const isbn = candidate.isbn ? extractIsbnFromText(candidate.isbn) : null;
    try {
      const book = await resolveBook(
        isbn
          ? { isbn }
          : { title: candidate.title ?? '', author: candidate.author },
        { googleBooksApiKey: keys.googleBooksApiKey },
      );
      return {
        raw: [candidate.title, candidate.author, candidate.isbn].filter(Boolean).join(' — '),
        book,
      };
    } catch (err) {
      return {
        raw: candidate.title ?? candidate.isbn ?? 'unknown',
        book: null as CanonicalBook | null,
        error: err instanceof Error ? err.message : 'Resolve failed',
      };
    }
  });

  return {
    results,
    message: `Detected ${results.filter((r) => r.book).length} of ${results.length}. Confirm before saving.`,
  };
}
