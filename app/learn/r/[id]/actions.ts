'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadReading } from '@/lib/learn/tracks/load';
import { locatePassage } from '@/lib/learn/locate/locate';
import { suggestSources } from '@/lib/learn/import/suggest';
import { resolvedSourceSchema, type ResolvedSource } from '@/lib/learn/import/resolve-payload';
import {
  attachSourceToReading,
  setReadingLocation,
  setReadingNote,
  setReadingStatus,
} from '@/lib/learn/tracks/save';

/**
 * What you can do to a reading.
 *
 * Every write goes through the session client, so RLS decides which row is
 * touched. The reading id comes from the form and is not trusted for
 * ownership -- the policy answers that, and a row belonging to somebody else
 * simply is not there to update.
 */

export type ReadingActionState = { error?: string };

export type FindState = {
  error?: string;
  /** Proposed, not saved. Nothing reaches the row until you pick one. */
  candidates?: ResolvedSource[];
};

/**
 * Find something to read about a subject you wrote down.
 *
 * Proposes and writes nothing, which is the same rule the import path follows
 * and matters more here: a search given only a subject has far more room to be
 * wrong than one given a citation, and a bad source in a queue costs twenty
 * minutes at the moment you were finally going to read something.
 */
export async function findSources(_prev: FindState, formData: FormData): Promise<FindState> {
  await requireUser();

  const readingId = z.string().uuid().safeParse(formData.get('readingId'));
  if (!readingId.success) return { error: 'Could not work out which one to search for.' };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Searching needs ANTHROPIC_API_KEY to be set.' };

  const supabase = await createLearnClient();
  const reading = await loadReading(supabase, readingId.data);
  if (!reading) return { error: 'That is not there any more.' };

  const result = await suggestSources({
    subject: reading.subject,
    question: reading.trackQuestion,
    anthropicApiKey: apiKey,
  });

  if (!result.ok) return { error: result.detail };
  return { candidates: result.sources };
}

/**
 * Attach the one you picked.
 *
 * The payload rides back through a hidden field, so it is re-validated here
 * rather than trusted -- a form field is user input whoever wrote the form.
 */
export async function attachSource(
  _prev: ReadingActionState,
  formData: FormData,
): Promise<ReadingActionState> {
  const user = await requireUser();

  const readingId = z.string().uuid().safeParse(formData.get('readingId'));
  if (!readingId.success) return { error: 'Could not work out which one to attach to.' };

  const raw = formData.get('chosen');
  if (typeof raw !== 'string') return { error: 'Pick one first.' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: 'That choice did not survive the trip. Search again.' };
  }

  const safe = resolvedSourceSchema.safeParse(parsed);
  if (!safe.success) return { error: 'That choice did not survive the trip. Search again.' };

  const supabase = await createLearnClient();
  try {
    await attachSourceToReading(supabase, user.id, readingId.data, safe.data);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not attach that.' };
  }

  revalidatePath(`/learn/r/${readingId.data}`);
  revalidatePath('/learn');
  return {};
}

const StatusInput = z.object({
  readingId: z.string().uuid(),
  status: z.enum(['queued', 'reading', 'read', 'abandoned']),
});

export async function updateStatus(
  _prev: ReadingActionState,
  formData: FormData,
): Promise<ReadingActionState> {
  await requireUser();

  const parsed = StatusInput.safeParse({
    readingId: formData.get('readingId'),
    status: formData.get('status'),
  });
  if (!parsed.success) return { error: 'That is not a status.' };

  const supabase = await createLearnClient();
  try {
    await setReadingStatus(supabase, parsed.data.readingId, parsed.data.status);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not update that.' };
  }

  revalidatePath(`/learn/r/${parsed.data.readingId}`);
  revalidatePath('/learn');
  return {};
}

const NoteInput = z.object({
  readingId: z.string().uuid(),
  note: z.string().max(20_000),
});

export async function updateNote(
  _prev: ReadingActionState,
  formData: FormData,
): Promise<ReadingActionState> {
  await requireUser();

  const parsed = NoteInput.safeParse({
    readingId: formData.get('readingId'),
    note: formData.get('note') ?? '',
  });
  if (!parsed.success) return { error: 'That note is too long to save.' };

  const supabase = await createLearnClient();
  try {
    await setReadingNote(supabase, parsed.data.readingId, parsed.data.note);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not save your note.' };
  }

  revalidatePath(`/learn/r/${parsed.data.readingId}`);
  return {};
}

/**
 * Open it — and, on the way, find the paragraph.
 *
 * This is the lazy locate pass, and it is a server action rather than a link
 * because the work happens between the click and the tab: fetch the document,
 * find the passage that answers the track's question, verify the phrase is
 * really in the page, then redirect to a URL that lands on it.
 *
 * Doing it here rather than at import time is what keeps the cost proportional
 * to what you actually read. A track of twenty readings costs nothing until
 * you start it.
 *
 * It never fails the click. Every way this can go wrong -- a paywall, a PDF, a
 * page that moved, a model that invents the quote -- ends with the URL you
 * already had and a basis recorded saying why it could not be narrowed. Being
 * sent to the top of the right page is the floor, not an error.
 */
export async function openReading(formData: FormData): Promise<void> {
  await requireUser();

  const readingId = z.string().uuid().safeParse(formData.get('readingId'));
  if (!readingId.success) redirect('/learn');

  const supabase = await createLearnClient();
  const reading = await loadReading(supabase, readingId.data);
  if (!reading) redirect('/learn');

  // A reading you wrote down yourself has nowhere to go yet. Back to its own
  // page, which says so.
  const url = reading.openUrl ?? reading.source?.canonicalUrl ?? null;
  if (!url) redirect(`/learn/r/${readingId.data}`);

  // Already narrowed and checked: nothing to do but go.
  if (reading.locatorConfidence === 'verified' && reading.textAnchor) {
    if (reading.status === 'queued') {
      await setReadingStatus(supabase, reading.id, 'reading').catch(() => {});
    }
    redirect(url);
  }

  const outcome = await locatePassage({
    url: reading.source?.canonicalUrl ?? url,
    question: reading.trackQuestion,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,
  });

  await setReadingLocation(supabase, reading.id, outcome).catch(() => {});
  if (reading.status === 'queued') {
    await setReadingStatus(supabase, reading.id, 'reading').catch(() => {});
  }

  revalidatePath(`/learn/r/${reading.id}`);
  redirect(outcome.openUrl);
}
