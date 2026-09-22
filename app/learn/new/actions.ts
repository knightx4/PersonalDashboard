'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { parseReferences } from '@/lib/learn/import/parse';
import { resolveOneReference } from '@/lib/learn/import/resolve';
import type { ReferenceCandidate } from '@/lib/learn/import/parse-heuristic';
import { resolvedSourceSchema, type ResolvedSource } from '@/lib/learn/import/resolve-payload';
import { createTrack, saveImport, type SaveRow } from '@/lib/learn/tracks/save';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';

/**
 * Bringing a reading list in.
 *
 * Two steps and a click between them. `previewImport` parses and resolves and
 * writes nothing; `confirmImport` writes what you ticked.
 *
 * The click is a queue, which this codebase is otherwise sceptical of -- the
 * vault spec's rule is that a module must never hand back a pile of things to
 * triage. It is here for the reason docs/EVIDENCE-LAYER.md gives for its own
 * confirm list, which is the stronger argument: a bad item does not merely sit
 * there. A wrong source is twenty wasted minutes at the exact moment you were
 * finally going to read something, and it is one untick to avoid on a screen
 * you were looking at anyway.
 */

export type PreviewRow = {
  raw: string;
  resolved: ResolvedSource | null;
  why: string | null;
  error?: string;
};

export type NewTrackState = { error?: string };

const PreviewInput = z.object({
  question: z.string().trim().max(2000),
  text: z.string().trim().min(1, 'Paste a reading list first.').max(40_000),
  sourceHint: z.string().trim().max(100),
});

/**
 * A track needs a name and nobody wants to invent one.
 *
 * The question makes the best title when there is one, trimmed to something
 * that fits a row. Falling back to a date beats falling back to "Untitled",
 * which tells you nothing six weeks later.
 */
function titleFor(question: string, text: string): string {
  const source = question || text;
  const firstLine = source.split(/\r?\n/).find((line) => line.trim().length > 0) ?? '';
  const cleaned = firstLine.replace(/^[\s\-–—*•·]+/, '').trim();
  if (cleaned.length >= 3) {
    return cleaned.length > 80 ? `${cleaned.slice(0, 77)}…` : cleaned;
  }
  return `Reading list, ${new Date().toISOString().slice(0, 10)}`;
}

export type ParsedImport = {
  title: string;
  question: string | null;
  rawText: string;
  sourceHint: string | null;
  candidates: ReferenceCandidate[];
  /** True when there is no API key, so nothing will be searched for. */
  unresolvable: boolean;
};

export type ParseState = { error?: string; parsed?: ParsedImport };

/**
 * Read the paste, and stop.
 *
 * Parsing is one cheap call and comes back in a second or two, so the list of
 * what was found appears almost immediately. Searching for each one is the
 * slow half and happens afterwards, one request per item, so rows fill in as
 * they land rather than the whole screen waiting on the slowest.
 *
 * Splitting it this way is also what keeps each request short. A single call
 * that resolved eight citations end to end is one long request that a platform
 * eventually cuts off, and when it does you lose all eight.
 */
// latency: pending
export async function parseImport(_prev: ParseState, formData: FormData): Promise<ParseState> {
  const user = await requireUser();

  const parsed = PreviewInput.safeParse({
    question: formData.get('question') ?? '',
    text: formData.get('text') ?? '',
    sourceHint: formData.get('sourceHint') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'That did not look like a reading list.' };
  }

  const { question, text, sourceHint } = parsed.data;
  const apiKey = process.env.ANTHROPIC_API_KEY ?? null;

  const spend = collectSpend();
  const candidates = await parseReferences(text, { anthropicApiKey: apiKey, onSpend: spend.sink });
  await recordLearnSpend(user.id, 'parse-references', spend.reports);
  if (candidates.length === 0) {
    return { error: 'Nothing in that paste looked like something to read.' };
  }

  return {
    parsed: {
      title: titleFor(question, text),
      question: question || null,
      rawText: text,
      sourceHint: sourceHint || null,
      candidates,
      // With no key the module still works: the heuristic found the citations
      // and they go in unresolved rather than not at all. A queue of titles you
      // have to search yourself is what you had before this existed.
      unresolvable: !apiKey,
    },
  };
}

/**
 * Find where one of them can be read.
 *
 * Called once per item, in parallel, from the screen. Never throws: a citation
 * that cannot be placed comes back carrying its reason, because one line
 * saying so is what stops you assuming the list was complete.
 */
// latency: pending
export async function resolveCandidate(input: {
  candidate: ReferenceCandidate;
  question: string | null;
}): Promise<PreviewRow> {
  const user = await requireUser();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      raw: input.candidate.raw,
      why: input.candidate.why,
      resolved: {
        title: input.candidate.title,
        author: input.candidate.author,
        kind: 'page' as const,
        canonical_url: input.candidate.url?.startsWith('https://') ? input.candidate.url : null,
        access: 'unknown' as const,
        locator_kind: 'whole' as const,
        locator_basis: 'Read from your paste; nothing was searched for or checked.',
        locator_verified: false,
        not_found: false,
      },
    };
  }

  const spend = collectSpend();
  const row = await resolveOneReference(input.candidate, {
    anthropicApiKey: apiKey,
    question: input.question,
    onSpend: spend.sink,
  });
  await recordLearnSpend(user.id, 'resolve-reference', spend.reports);

  return {
    raw: row.candidate.raw,
    why: row.candidate.why,
    resolved: row.resolved,
    error: row.error,
  };
}

/**
 * A track with nothing in it.
 *
 * The broad thing, written down on its own. No paste, so nothing to parse,
 * nothing to search for and nothing to confirm -- this writes immediately,
 * unlike the import path, because there is no proposal to check. You typed a
 * name and you meant it.
 */
const NewTrackInput = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Give the topic a name.')
    .max(300, 'That name is too long — the detail belongs in the question.'),
  question: z.string().trim().max(2000),
});

// latency: pending
export async function startTrack(
  _prev: NewTrackState,
  formData: FormData,
): Promise<NewTrackState> {
  const user = await requireUser();

  const parsed = NewTrackInput.safeParse({
    title: formData.get('title') ?? '',
    question: formData.get('question') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Could not start that topic.' };
  }

  const supabase = await createLearnClient();
  let trackId: string;
  try {
    trackId = await createTrack(supabase, user.id, {
      title: parsed.data.title,
      question: parsed.data.question || null,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not start that topic.' };
  }

  revalidatePath('/learn/lists');
  redirect(`/learn/t/${trackId}`);
}

const ConfirmInput = z.object({
  title: z.string().trim().min(1).max(300),
  question: z.string().trim().max(2000),
  rawText: z.string().trim().min(1).max(40_000),
  sourceHint: z.string().trim().max(100),
});

// latency: pending
export async function confirmImport(
  _prev: NewTrackState,
  formData: FormData,
): Promise<NewTrackState> {
  const user = await requireUser();

  const parsed = ConfirmInput.safeParse({
    title: formData.get('title') ?? '',
    question: formData.get('question') ?? '',
    rawText: formData.get('rawText') ?? '',
    sourceHint: formData.get('sourceHint') ?? '',
  });
  if (!parsed.success) return { error: 'Something went wrong saving that. Try again.' };

  // Only the rows still ticked. The payloads ride in hidden fields, so they
  // are re-validated here rather than trusted -- a form field is user input
  // whoever wrote the form.
  const rows: SaveRow[] = [];
  for (const raw of formData.getAll('row')) {
    if (typeof raw !== 'string') continue;
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      continue;
    }
    const shape = z
      .object({ resolved: resolvedSourceSchema, why: z.string().nullable() })
      .safeParse(payload);
    if (shape.success) rows.push({ resolved: shape.data.resolved, why: shape.data.why });
  }

  if (rows.length === 0) return { error: 'Tick at least one thing to save.' };

  const supabase = await createLearnClient();
  let trackId: string;
  try {
    const result = await saveImport(supabase, user.id, {
      title: parsed.data.title,
      question: parsed.data.question || null,
      rows,
      rawText: parsed.data.rawText,
      sourceHint: parsed.data.sourceHint || null,
      parsed: rows.map((row) => ({ title: row.resolved.title, why: row.why })),
    });
    trackId = result.trackId;
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not save that reading list.' };
  }

  revalidatePath('/learn/lists');
  redirect(`/learn/t/${trackId}`);
}
