'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createNewsClient } from '@/lib/news/auth/server';
import { markUnread } from '@/lib/news/issues/read';
import { removeSavedStory, saveStory } from '@/lib/news/saved/stories';

const UnreadInput = z.object({ issueId: z.string().uuid() });

/**
 * Put an issue back in the unread list, and go there.
 *
 * It ends on the list, /news/all, rather than on the issue because opening the issue is what
 * marks it read: staying would set the time again on the next render and the
 * button would do nothing you could see.
 */
// latency: pending
export async function markIssueUnread(formData: FormData): Promise<void> {
  const parsed = UnreadInput.safeParse({ issueId: formData.get('issueId') });
  if (!parsed.success) return;

  const client = await createNewsClient();
  await markUnread(client, parsed.data.issueId);

  revalidatePath('/news/all');
  redirect('/news/all');
}

const SaveInput = z.object({
  issueId: z.string().uuid(),
  headline: z.string().trim().min(1),
  saved: z.boolean(),
});

/**
 * Save a story to the Saved list, or take it off (plan #869). Shared by the
 * issue page's stories and the Quick read card.
 *
 * The form names only the issue and the headline: saveStory reads the story
 * again from the newsletter, so the copy is what the email said rather than
 * what the browser sent. `saved` is the state wanted, not a flip, so a second
 * press that lands after the first has failed cannot invert the result.
 *
 * Both pages a story can be saved from are refreshed so the button comes back
 * as the server now has it, and the Saved tab so it lists the change.
 */
// latency: optimistic -- the button reads Saved at once, and a refused write puts it back with a toast
export async function setStorySaved(
  issueId: string,
  headline: string,
  saved: boolean,
): Promise<{ error: string | null }> {
  const parsed = SaveInput.safeParse({ issueId, headline, saved });
  if (!parsed.success) return { error: 'That story could not be found.' };

  const user = await requireUser();
  const client = await createNewsClient();
  try {
    if (parsed.data.saved) {
      const found = await saveStory(client, { userId: user.id, ...parsed.data });
      if (!found) return { error: 'That story is no longer in the newsletter.' };
    } else {
      await removeSavedStory(client, parsed.data);
    }
  } catch {
    return {
      error: parsed.data.saved
        ? 'That story did not save. Try again.'
        : 'That story is still saved. Try again.',
    };
  }

  revalidatePath(`/news/i/${parsed.data.issueId}`);
  revalidatePath('/news');
  revalidatePath('/news/saved');
  return { error: null };
}
