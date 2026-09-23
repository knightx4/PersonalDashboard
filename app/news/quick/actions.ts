'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createNewsClient } from '@/lib/news/auth/server';
import { passStory } from '@/lib/news/issues/quick';

const PassInput = z.object({
  issueId: z.string().uuid(),
  storyIndex: z.coerce.number().int().min(0),
});

/**
 * Record the story you were shown and bring up the next one.
 *
 * The next card is whatever the page works out once this has run, so the
 * action only records and then asks for the page again. When the pass was the
 * last story of its newsletter, passStory marks the newsletter read and the
 * list is refreshed as well, so the two pages agree.
 *
 * The user id is the session's; the form names only the story.
 */
// latency: pending
export async function passQuickStory(formData: FormData): Promise<void> {
  const parsed = PassInput.safeParse({
    issueId: formData.get('issueId'),
    storyIndex: formData.get('storyIndex'),
  });
  if (!parsed.success) return;

  const user = await requireUser();
  const client = await createNewsClient();
  const { finished } = await passStory(client, { userId: user.id, ...parsed.data });

  revalidatePath('/news/quick');
  if (finished) revalidatePath('/news');
}

/**
 * Record a story whose article you opened, without moving the card on.
 *
 * The article opens in a new tab while this runs, and the card stays where it
 * was so you can come back to it and press Next. Nothing is revalidated, so
 * the page is not drawn again under you. Next records the same story a second
 * time, which the upsert ignores.
 */
// latency: instant -- the link opens its tab at once and nothing on the page waits for the write
export async function recordArticleOpened(issueId: string, storyIndex: number): Promise<void> {
  const parsed = PassInput.safeParse({ issueId, storyIndex });
  if (!parsed.success) return;

  const user = await requireUser();
  const client = await createNewsClient();
  await passStory(client, { userId: user.id, ...parsed.data });
}
