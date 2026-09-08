'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { addManualReading, deleteReading } from '@/lib/learn/tracks/save';

/**
 * Adding to a track by hand, and taking things off it.
 *
 * Every write goes through the session client, so RLS decides which rows are
 * touched. The track id comes from the form and is not trusted for ownership:
 * the insert carries the user id from the session, and a track belonging to
 * somebody else fails the policy rather than being filtered out here.
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

export async function removeFromTrack(
  _prev: TrackActionState,
  formData: FormData,
): Promise<TrackActionState> {
  await requireUser();

  const parsed = RemoveInput.safeParse({
    readingId: formData.get('readingId'),
    trackId: formData.get('trackId'),
  });
  if (!parsed.success) return { error: 'Could not remove that.' };

  const supabase = await createLearnClient();
  try {
    await deleteReading(supabase, parsed.data.readingId);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not remove that.' };
  }

  revalidatePath(`/learn/t/${parsed.data.trackId}`);
  revalidatePath('/learn');
  return {};
}
