'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createNewsClient } from '@/lib/news/auth/server';
import { openStory, passStories, unpassStories } from '@/lib/news/issues/quick';
import { readTopic } from '@/lib/news/issues/topics';
import { hideTopic } from '@/lib/news/quick/hidden-topics';

const PassInput = z.object({
  issueId: z.string().uuid(),
  storyIndex: z.coerce.number().int().min(0),
});

/**
 * A page of Quick read holds at most QUICK_PAGE_SIZE stories, each with the
 * repeats it folds; an event is rarely in more than five newsletters.
 */
const PageInput = z.array(PassInput).min(1).max(60);

/**
 * The issueId and storyIndex pairs a form sends, in order. Next sends its
 * card and the same event's stories in other newsletters (plan #865); Next
 * page sends every card on the page with theirs.
 */
function readPairs(formData: FormData) {
  const issueIds = formData.getAll('issueId');
  const indexes = formData.getAll('storyIndex');
  if (issueIds.length !== indexes.length) return null;
  const parsed = PageInput.safeParse(
    issueIds.map((issueId, i) => ({ issueId, storyIndex: indexes[i] })),
  );
  return parsed.success ? parsed.data : null;
}

/**
 * Record the story you were shown, and its repeats in other newsletters, and
 * bring up the next one.
 *
 * The next card is whatever the page works out once this has run, so the
 * action only records and then asks for the page again. When a pass was the
 * last story of its newsletter, that newsletter is marked read and the list is
 * refreshed as well, so the two pages agree.
 *
 * The user id is the session's; the form names only the stories.
 */
// latency: pending
export async function passQuickStory(formData: FormData): Promise<void> {
  const stories = readPairs(formData);
  if (!stories) return;

  const user = await requireUser();
  const client = await createNewsClient();
  const { finished } = await passStories(client, { userId: user.id, stories });

  revalidatePath('/news');
  if (finished) revalidatePath('/news/all');
}

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
  const stories = readPairs(formData);
  if (!stories) return;

  const user = await requireUser();
  const client = await createNewsClient();
  const { finished } = await passStories(client, { userId: user.id, stories });

  revalidatePath('/news');
  if (finished) revalidatePath('/news/all');
}

/**
 * Previous page on a laptop (note 460be33e): take back the passes the last
 * Next page recorded, so a page skipped too fast comes back. The form carries
 * the stories that page showed, which the browser kept when Next page was
 * pressed; nothing on the server remembers pages.
 */
// latency: pending
export async function unpassQuickPage(formData: FormData): Promise<void> {
  const stories = readPairs(formData);
  if (!stories) return;

  await requireUser();
  const client = await createNewsClient();
  await unpassStories(client, { stories });

  revalidatePath('/news');
  revalidatePath('/news/all');
}

/**
 * Record a story whose article you opened, without moving the card on. The
 * open is kept as well as the pass, and Quick read's ranking reads it as
 * interest in the story's topic and newsletter.
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
  await openStory(client, { userId: user.id, ...parsed.data });
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
