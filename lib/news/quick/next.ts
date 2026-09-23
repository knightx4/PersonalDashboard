import { senderLabel, type NewsSender } from '@/lib/news/issues/list';
import { readStories, type NewsStory } from '@/lib/news/issues/stories';
import { NEWS_TOPICS, type NewsTopic } from '@/lib/news/issues/topics';

/**
 * One newsletter as Quick read needs it.
 *
 * `stories` is the column exactly as stored, not run through readStories,
 * because a pass is keyed on a story's position in the stored array
 * (news.story_passes, supabase/migrations-news/0007_story_passes.sql).
 * Filtering first and numbering afterwards would give a story the wrong
 * index whenever an entry before it is malformed.
 *
 * `summary` is null while the newsletter has not been summarised, or when
 * summarising it failed. Those are left out of Quick read.
 */
export type QuickIssue = {
  id: string;
  senderId: string;
  subject: string | null;
  receivedAt: string;
  summary: string | null;
  stories: unknown;
};

/** A story you have moved past, as news.story_passes records it. */
export type StoryPass = { issueId: string; storyIndex: number };

/** What the card shows: one story, or the summary of a newsletter that is one essay. */
export type QuickCardBody =
  | { kind: 'story'; story: NewsStory }
  | { kind: 'essay'; summary: string };

/**
 * What narrows Quick read beyond muting and passing (plan #860).
 *
 * `topic` keeps only stories tagged with it, from every newsletter. An essay
 * card carries no topic, so it is left out while a topic is picked. A story
 * that fits is decided in one place, `fits`, so a later rule such as a list
 * of hidden topics goes there too.
 */
export type QuickFilter = { topic?: NewsTopic | null };

/** The next card, with what the page needs to draw it and to record the pass. */
export type QuickCard = QuickCardBody & {
  issueId: string;
  /** The position to record the pass under: the story's index in the stored array, 0 for an essay. */
  storyIndex: number;
  subject: string | null;
  receivedAt: string;
  sender: NewsSender | null;
  /** The newsletter's name: the sender's name, or its address, or null when the sender is missing. */
  from: string | null;
  /** Cards from this newsletter not yet passed, this one included. 1 means this is its last. */
  remainingInIssue: number;
};

type Slot = { storyIndex: number; body: QuickCardBody };

/**
 * Every card a newsletter makes, in the order the email gave its stories.
 *
 * A story that readStories would drop (no headline or no summary) makes no
 * card, and the stories after it keep their own positions. A summarised
 * newsletter with no readable story is one essay card at position 0 carrying
 * its summary; that covers the empty list an essay is stored with, and keeps a
 * newsletter whose every story is malformed from vanishing from Quick read.
 */
function slots(issue: QuickIssue): Slot[] {
  if (!issue.summary?.trim() || !Array.isArray(issue.stories)) return [];
  const found: Slot[] = [];
  issue.stories.forEach((entry, storyIndex) => {
    const [story] = readStories([entry]);
    if (story) found.push({ storyIndex, body: { kind: 'story', story } });
  });
  if (found.length) return found;
  return [{ storyIndex: 0, body: { kind: 'essay', summary: issue.summary.trim() } }];
}

function fits(slot: Slot, filter: QuickFilter): boolean {
  if (!filter.topic) return true;
  return slot.body.kind === 'story' && slot.body.story.topic === filter.topic;
}

/**
 * The newsletters Quick read draws from, newest first: muted senders left
 * out, and newsletters that arrived at the same moment in the order given.
 */
function readable(
  issues: readonly QuickIssue[],
  byId: ReadonlyMap<string, NewsSender>,
): QuickIssue[] {
  return issues
    .filter((issue) => !byId.get(issue.senderId)?.muted)
    .map((issue, order) => ({ issue, order }))
    .sort((a, b) => arrival(b.issue) - arrival(a.issue) || a.order - b.order)
    .map(({ issue }) => issue);
}

function passedIn(issueId: string, passes: readonly StoryPass[]): Set<number> {
  return new Set(passes.filter((p) => p.issueId === issueId).map((p) => p.storyIndex));
}

function arrival(issue: QuickIssue): number {
  const time = Date.parse(issue.receivedAt);
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

/**
 * The story Quick read shows next, or null when you are caught up.
 *
 * The order is the one #846 settled: the newest newsletter first, and within
 * it the stories in the order the email gave them. A newsletter from a muted
 * sender is left out, as are stories already passed and newsletters that have
 * not been summarised. Newsletters that arrived at the same moment keep the
 * order they were given in. `filter` narrows it further; `remainingInIssue`
 * then counts only the cards that fit it.
 */
export function nextCard(
  issues: readonly QuickIssue[],
  senders: readonly NewsSender[],
  passes: readonly StoryPass[],
  filter: QuickFilter = {},
): QuickCard | null {
  const byId = new Map(senders.map((sender) => [sender.id, sender]));

  for (const issue of readable(issues, byId)) {
    const passed = passedIn(issue.id, passes);
    const left = slots(issue).filter((slot) => !passed.has(slot.storyIndex) && fits(slot, filter));
    if (!left.length) continue;
    const sender = byId.get(issue.senderId) ?? null;
    return {
      ...left[0].body,
      issueId: issue.id,
      storyIndex: left[0].storyIndex,
      subject: issue.subject,
      receivedAt: issue.receivedAt,
      sender,
      from: sender ? senderLabel(sender) : null,
      remainingInIssue: left.length,
    };
  }
  return null;
}

/**
 * The topics Quick read has a story left on, in NEWS_TOPICS order: the chips
 * drawn above the card. Muted senders and passed stories do not count, the
 * same as for nextCard, so every chip leads to at least one card.
 */
export function quickTopics(
  issues: readonly QuickIssue[],
  senders: readonly NewsSender[],
  passes: readonly StoryPass[],
): NewsTopic[] {
  const byId = new Map(senders.map((sender) => [sender.id, sender]));
  const found = new Set<NewsTopic>();
  for (const issue of readable(issues, byId)) {
    const passed = passedIn(issue.id, passes);
    for (const slot of slots(issue)) {
      if (passed.has(slot.storyIndex) || slot.body.kind !== 'story') continue;
      if (slot.body.story.topic) found.add(slot.body.story.topic);
    }
  }
  return NEWS_TOPICS.filter((topic) => found.has(topic));
}

/**
 * Where Quick read lives with the reader's choices on it. Pictures are on
 * unless turned off, so only `pictures=0` is written, and no topic means
 * every topic.
 */
export function quickHref({
  pictures,
  topic,
}: {
  pictures: boolean;
  topic: NewsTopic | null;
}): string {
  const query = new URLSearchParams();
  if (!pictures) query.set('pictures', '0');
  if (topic) query.set('topic', topic);
  const search = query.toString();
  return search ? `/news?${search}` : '/news';
}

/**
 * Whether every card a newsletter makes has been passed.
 *
 * The Next action asks this after recording a pass, to mark the newsletter
 * read in the list once nothing of it is left. An unsummarised newsletter
 * makes no cards and is never finished here, since Quick read never showed it.
 */
export function issueFinished(issue: QuickIssue, passes: readonly StoryPass[]): boolean {
  const cards = slots(issue);
  if (!cards.length) return false;
  const passed = passedIn(issue.id, passes);
  return cards.every((slot) => passed.has(slot.storyIndex));
}
