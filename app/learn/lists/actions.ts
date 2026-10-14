'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { createTrack } from '@/lib/learn/tracks/save';

/**
 * Starting a topic from a form: Start a track under a phrase explained on a
 * Learn now card. The reading lists' own Start a topic goes through capture
 * (plan #1950.4); this stays for a form that already holds the name.
 */

export type NewTrackState = { error?: string };

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
