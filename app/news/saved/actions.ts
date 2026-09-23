'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createNewsClient } from '@/lib/news/auth/server';
import { removeSavedStoryById } from '@/lib/news/saved/stories';

const RemoveInput = z.object({ id: z.string().uuid() });

/**
 * Take a story off the Saved tab (plan #870).
 *
 * Keyed on the saved row's id rather than on issue and headline, because a
 * story outlives its newsletter and then has no issue to name. The Saved tab
 * is refreshed, and so are Quick read and the story's issue page while it has
 * one, so their Save buttons stop reading Saved.
 */
// latency: optimistic -- the story leaves the list at once, and a refused write puts it back with a toast
export async function removeSaved(id: string): Promise<{ error: string | null }> {
  const parsed = RemoveInput.safeParse({ id });
  if (!parsed.success) return { error: 'That story could not be found.' };

  const client = await createNewsClient();
  let issueId: string | null;
  try {
    ({ issueId } = await removeSavedStoryById(client, parsed.data.id));
  } catch {
    return { error: 'That story is still saved. Try again.' };
  }

  revalidatePath('/news/saved');
  revalidatePath('/news');
  if (issueId) revalidatePath(`/news/i/${issueId}`);
  return { error: null };
}
