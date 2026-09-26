'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import { serverEnv } from '@/lib/env';
import { createNewsClient } from '@/lib/news/auth/server';
import { NEWS_SCHEMA } from '@/lib/news/db/schema-name';
import { openStory, passStories, unpassStories } from '@/lib/news/issues/quick';
import { readStories } from '@/lib/news/issues/stories';
import {
  discussGuidance,
  discussionClosed,
  roundsTaken,
  storyMaterial,
  storyRef,
  storySubject,
} from '@/lib/news/quick/discuss';
import { setReaction } from '@/lib/news/quick/reactions';
import { replyAbout } from '@/lib/talk/reply';
import { appendTurns, loadConversation } from '@/lib/talk/store';
import { turnBody, type TalkTurn } from '@/lib/talk/talk';

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

const ReactInput = z.object({
  issueId: z.string().uuid(),
  storyIndex: z.number().int().min(0),
  reaction: z.enum(['up', 'down']).nullable(),
});

/**
 * Thumbs up or thumbs down on a card, or null to take it back. They took the
 * place of Fewer like this on the card.
 *
 * For now this only records the press: the card stays, nothing is hidden and
 * the ranking does not read it yet (lib/news/quick/reactions.ts). `reaction`
 * is the state wanted rather than a flip, so a second press that lands after
 * a failed first cannot invert it. Quick read is refreshed so the button comes
 * back as the server now has it; the card is the same one, since a reaction
 * changes nothing about which card is next.
 */
// latency: optimistic -- the thumb fills at once, and a refused write puts it back with a toast
export async function reactToQuickStory(
  issueId: string,
  storyIndex: number,
  reaction: 'up' | 'down' | null,
): Promise<{ error: string | null }> {
  const parsed = ReactInput.safeParse({ issueId, storyIndex, reaction });
  if (!parsed.success) return { error: 'That story could not be found.' };

  const user = await requireUser();
  const client = await createNewsClient();
  try {
    const found = await setReaction(client, { userId: user.id, ...parsed.data });
    if (!found) return { error: 'That newsletter is no longer there.' };
  } catch {
    return { error: 'That did not save. Try again.' };
  }
  revalidatePath('/news');
  return { error: null };
}

/**
 * The discussion of one story so far (plan #1060), oldest first, for the
 * Discuss sheet to show when it opens. Read each time the sheet opens rather
 * than with the page, so Quick read's load is unchanged and a reopened story
 * shows what was said in another tab. Empty when there is none.
 */
// latency: pending -- the sheet opens at once and shows the thread when it arrives
export async function loadStoryDiscussion(
  issueId: string,
  storyIndex: number,
): Promise<{ turns: TalkTurn[]; error: string | null }> {
  const parsed = PassInput.safeParse({ issueId, storyIndex });
  if (!parsed.success) return { turns: [], error: 'That story could not be found.' };

  await requireUser();
  const core = await createCoreClient();
  try {
    const turns = await loadConversation(core, {
      kind: 'news_story',
      ref: storyRef(parsed.data.issueId, parsed.data.storyIndex),
    });
    return { turns, error: null };
  } catch {
    return { turns: [], error: 'Your discussion could not be read. Try again.' };
  }
}

function anthropicKey(): string | undefined {
  try {
    return serverEnv().ANTHROPIC_API_KEY ?? undefined;
  } catch {
    return process.env.ANTHROPIC_API_KEY ?? undefined;
  }
}

/**
 * One round of discussing a Quick read story with Dash (plan #1060): keep
 * what the person wrote, then Dash's reply, which argues the other side or
 * asks what their view rests on. The third reply closes the discussion with
 * a line on where their view held and where it was thin, and nothing more is
 * taken after it.
 *
 * The story is read again from the newsletter rather than taken from the
 * browser: its headline, summary and the story's own text are what Dash
 * reads. The person's turn is written before the reply is asked for, so a
 * failed reply keeps it, and the turns returned are what the table holds.
 * The reply's cost is recorded under news, discuss-story.
 */
// latency: pending -- the view shows in the thread at once and "Dash is replying" holds the place of the reply
export async function discussQuickStory(
  issueId: string,
  storyIndex: number,
  raw: string,
): Promise<{ turns?: TalkTurn[]; error?: string }> {
  const parsed = PassInput.safeParse({ issueId, storyIndex });
  if (!parsed.success) return { error: 'That story could not be found.' };
  const checked = turnBody(raw);
  if ('error' in checked) return { error: checked.error };

  const user = await requireUser();
  const [news, core] = await Promise.all([createNewsClient(), createCoreClient()]);

  const { data: issue, error: issueError } = await news
    .from('issues')
    .select('stories')
    .eq('id', parsed.data.issueId)
    .maybeSingle();
  assertSchemaExposed(issueError, NEWS_SCHEMA);
  if (issueError) return { error: 'The story could not be read. Try again.' };
  // Indexed in the raw array, as reactions.ts does: readStories drops
  // malformed entries, which would shift every index after them.
  const stories = (issue as { stories: unknown } | null)?.stories;
  const entry = Array.isArray(stories) ? stories[parsed.data.storyIndex] : undefined;
  const [story] = entry === undefined ? [] : readStories([entry]);
  if (!story) return { error: 'That story is no longer in its newsletter.' };

  const subject = storySubject(parsed.data.issueId, parsed.data.storyIndex, story.headline);
  let earlier: TalkTurn[];
  let kept: TalkTurn[];
  try {
    earlier = await loadConversation(core, subject);
    if (discussionClosed(earlier)) return { error: 'This discussion has had its three rounds.' };
    kept = await appendTurns(core, user.id, subject, [{ role: 'user', body: checked.body }]);
  } catch {
    return { error: 'That was not kept. Try again.' };
  }

  const key = anthropicKey();
  if (!key) return { turns: kept, error: 'This deployment has no ANTHROPIC_API_KEY, so Dash cannot reply.' };

  const spent: SpendReport[] = [];
  const reply = await replyAbout({
    subject: { kind: 'news_story', title: story.headline, material: storyMaterial(story) },
    turns: [...earlier, ...kept],
    guidance: discussGuidance(roundsTaken(earlier) + 1),
    anthropicApiKey: key,
    onSpend: (report) => spent.push(report),
  });
  for (const report of spent) {
    await recordSpend(core, user.id, {
      module: 'news',
      operation: 'discuss-story',
      model: report.model,
      usage: report.usage,
    });
  }
  if (!reply.ok) return { turns: kept, error: `Dash could not reply: ${reply.detail}` };

  try {
    const answer = await appendTurns(core, user.id, subject, [
      { role: 'assistant', body: reply.reply },
    ]);
    return { turns: [...kept, ...answer] };
  } catch {
    return { turns: kept, error: 'Dash replied, but the reply was not kept. Try again.' };
  }
}
