'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { addManualReading, deleteReading, deleteTrack } from '@/lib/learn/tracks/save';

/**
 * Adding to a track by hand, and taking things off it.
 *
 * Every write goes through the session client, so RLS decides which rows are
 * touched. The ids come from the form and are not trusted for ownership: the
 * insert carries the user id from the session, and a row belonging to somebody
 * else fails the policy rather than being filtered out here.
 *
 * The two removals take a plain FormData because ConfirmStep calls them
 * directly rather than through useActionState. They are genuinely destructive
 * and there is no undo, which is exactly the case that component exists for --
 * a second click in the same place with the consequence written beside it.
 */

export type TrackActionState = { error?: string };

const AddInput = z.object({
  trackId: z.string().uuid(),
  title: z
    .string()
    .trim()
    .min(1, 'Write down what you want to learn.')
    .max(500, 'That is too long — put the detail in the note instead.'),
  why: z.string().trim().max(500),
});

export async function addToTrack(
  _prev: TrackActionState,
  formData: FormData,
): Promise<TrackActionState> {
  const user = await requireUser();

  const parsed = AddInput.safeParse({
    trackId: formData.get('trackId'),
    title: formData.get('title') ?? '',
    why: formData.get('why') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Could not add that.' };
  }

  const supabase = await createLearnClient();
  try {
    await addManualReading(supabase, user.id, {
      trackId: parsed.data.trackId,
      title: parsed.data.title,
      why: parsed.data.why || null,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not add that.' };
  }

  revalidatePath(`/learn/t/${parsed.data.trackId}`);
  revalidatePath('/learn');
  return {};
}

const RemoveInput = z.object({
  readingId: z.string().uuid(),
  trackId: z.string().uuid(),
});

/**
 * Take one reading off a track.
 *
 * Throws rather than returning an error, because ConfirmStep renders what a
 * rejected promise says and a message returned quietly would leave the button
 * looking like it worked.
 */
export async function removeFromTrack(formData: FormData): Promise<void> {
  await requireUser();

  const parsed = RemoveInput.safeParse({
    readingId: formData.get('readingId'),
    trackId: formData.get('trackId'),
  });
  if (!parsed.success) throw new Error('Could not work out what to remove.');

  const supabase = await createLearnClient();
  await deleteReading(supabase, parsed.data.readingId);

  revalidatePath(`/learn/t/${parsed.data.trackId}`);
  revalidatePath('/learn');
}

/**
 * Delete a whole track.
 *
 * Its readings and its import go with it, on the foreign keys. The sources do
 * not: they are shared across tracks, and deleting one track must not take a
 * work another track still points at.
 */
export async function removeTrack(formData: FormData): Promise<void> {
  await requireUser();

  const trackId = z.string().uuid().safeParse(formData.get('trackId'));
  if (!trackId.success) throw new Error('Could not work out which track to delete.');

  const supabase = await createLearnClient();
  await deleteTrack(supabase, trackId.data);

  revalidatePath('/learn');
  redirect('/learn');
}
