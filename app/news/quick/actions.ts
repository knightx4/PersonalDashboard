'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createNewsClient } from '@/lib/news/auth/server';
import { passStories, passStory } from '@/lib/news/issues/quick';
import { readTopic } from '@/lib/news/issues/topics';
import { hideTopic } from '@/lib/news/quick/hidden-topics';

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

  revalidatePath('/news');
  if (finished) revalidatePath('/news/all');
}

/** A page of Quick read holds at most QUICK_PAGE_SIZE stories; a little room over that is harmless. */
const PageInput = z.array(PassInput).min(1).max(24);

/**
 * Next page on a laptop (plan #941): record every story the grid showed and
 * bring up the next set.
 *
 * #939 settled that one press marks the whole page as seen, read or not. The
 * form carries one issueId and one storyIndex per story, in the same order, and
 * the pairs are read back together. As with passQuickStory the next page is
 * whatever the page works out once this has run, and the newsletter list is
 * refreshed when a pass finished one of them.
 */
// latency: pending
export async function passQuickPage(formData: FormData): Promise<void> {
  const issueIds = formData.getAll('issueId');
  const indexes = formData.getAll('storyIndex');
  if (issueIds.length !== indexes.length) return;
  const parsed = PageInput.safeParse(
    issueIds.map((issueId, i) => ({ issueId, storyIndex: indexes[i] })),
  );
  if (!parsed.success) return;

  const user = await requireUser();
  const client = await createNewsClient();
  const { finished } = await passStories(client, { userId: user.id, stories: parsed.data });

  revalidatePath('/news');
  if (finished) revalidatePath('/news/all');
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

/**
 * Fewer like this (plan #861): hide the card's topic from Quick read and bring
 * up the next card.
 *
 * Nothing is passed. The card leaves because its topic is now hidden, and it
 * comes back if the topic is brought back from News settings. The newsletter
 * list is untouched, so only Quick read and the settings page are refreshed.
 */
// latency: pending
export async function hideQuickTopic(formData: FormData): Promise<void> {
  const topic = readTopic(formData.get('topic'));
  if (!topic) return;

  const user = await requireUser();
  const client = await createNewsClient();
  await hideTopic(client, { userId: user.id, topic });

  revalidatePath('/news');
  revalidatePath('/news/settings');
}
