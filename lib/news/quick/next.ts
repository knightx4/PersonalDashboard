import { senderLabel, type NewsSender } from '@/lib/news/issues/list';
import { readStories, type NewsStory } from '@/lib/news/issues/stories';
import { NEWS_TOPICS, type NewsTopic } from '@/lib/news/issues/topics';
import { interestModel, rankReason, storyScore, type InterestRow } from './rank';

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
 * What narrows Quick read beyond muting and passing.
 *
 * `topic` (plan #860) keeps only stories tagged with it, from every
 * newsletter. An essay card carries no topic, so it is left out while a topic
 * is picked. `hidden` (plan #861) is the topics put aside with Fewer like
 * this: a story tagged with one of them is left out. An essay and an untagged
 * story have no topic to hide, so they stay. A story that fits is decided in
 * one place, `fits`.
 */
export type QuickFilter = { topic?: NewsTopic | null; hidden?: readonly NewsTopic[] };

/** Another newsletter that ran the same event as a card (plan #865). */
export type AlsoIn = { issueId: string; from: string };

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
  /** The other newsletters that ran this event, one entry each, newest first. */
  alsoIn: AlsoIn[];
  /**
   * The same event's stories in those newsletters, not yet passed. Next
   * records them with this one, so each of those newsletters can finish.
   */
  repeats: StoryPass[];
  /** Why the card is near the top, when something stands out (rankReason). */
  reason: string | null;
};

/**
 * What Quick read knows beyond the newsletters and passes, from
 * lib/news/issues/quick.ts. Left out, stories come in the order #846 set:
 * newest newsletter first, each in the email's order, nothing folded.
 *
 * `groups` are news.story_groups rows: which stories are the same event. Their
 * `storyIndex` is the story's place among the readable stories (readStories),
 * which is how groupStories numbers them. `interest` is news.story_interest.
 * `now` is for tests.
 */
export type QuickSignals = {
  groups?: readonly StoryGroupRow[];
  interest?: readonly InterestRow[];
  now?: number;
};

export type StoryGroupRow = { issueId: string; storyIndex: number; groupId: string };

type Slot = {
  storyIndex: number;
  /** The story's place among the readable stories, or null for an essay. */
  readIndex: number | null;
  body: QuickCardBody;
};

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
    if (story) found.push({ storyIndex, readIndex: found.length, body: { kind: 'story', story } });
  });
  if (found.length) return found;
  return [
    { storyIndex: 0, readIndex: null, body: { kind: 'essay', summary: issue.summary.trim() } },
  ];
}

function fits(slot: Slot, filter: QuickFilter): boolean {
  const topic = topicOf(slot);
  if (topic && filter.hidden?.includes(topic)) return false;
  if (!filter.topic) return true;
  return topic === filter.topic;
}

function topicOf(slot: Slot): NewsTopic | undefined {
  return slot.body.kind === 'story' ? slot.body.story.topic : undefined;
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

/** One card that could be shown, before repeats are folded and the rest ranked. */
type Candidate = {
  issue: QuickIssue;
  slot: Slot;
  /** Its place in #846's order, which breaks ties. */
  order: number;
  groupId: string | null;
  passed: boolean;
};

/**
 * Every card of every readable newsletter, in #846's order, with its group
 * and whether it was passed. A story counts as passed when any story of its
 * group was, so an event you moved past does not come back from the next
 * newsletter to cover it.
 */
function candidates(
  issues: readonly QuickIssue[],
  byId: ReadonlyMap<string, NewsSender>,
  passes: readonly StoryPass[],
  groups: readonly StoryGroupRow[],
): Candidate[] {
  const groupOf = new Map(groups.map((row) => [`${row.issueId}:${row.storyIndex}`, row.groupId]));
  const all: Candidate[] = [];
  for (const issue of readable(issues, byId)) {
    const passed = passedIn(issue.id, passes);
    for (const slot of slots(issue)) {
      const groupId =
        slot.readIndex === null ? null : (groupOf.get(`${issue.id}:${slot.readIndex}`) ?? null);
      all.push({ issue, slot, order: all.length, groupId, passed: passed.has(slot.storyIndex) });
    }
  }
  const passedGroups = new Set(all.flatMap((c) => (c.passed && c.groupId ? [c.groupId] : [])));
  for (const c of all) if (c.groupId && passedGroups.has(c.groupId)) c.passed = true;
  return all;
}

/**
 * Which of a group's cards stands for it: the one with an article link, then
 * a picture, then the email's own text, then the newest.
 */
function fullness(c: Candidate): number {
  if (c.slot.body.kind !== 'story') return 0;
  const { story } = c.slot.body;
  return (story.link ? 4 : 0) + (story.image ? 2 : 0) + (story.text ? 1 : 0);
}

/**
 * The cards left, best first.
 *
 * Without `signals` this is #846's order and nothing is folded. With them,
 * the stories of one event become one card, the fullest of them, naming the
 * other newsletters; and every card is ranked by storyScore, ties kept in
 * #846's order.
 */
function rankedCards(
  issues: readonly QuickIssue[],
  senders: readonly NewsSender[],
  passes: readonly StoryPass[],
  filter: QuickFilter,
  signals?: QuickSignals,
): QuickCard[] {
  const byId = new Map(senders.map((sender) => [sender.id, sender]));
  const all = candidates(issues, byId, passes, signals?.groups ?? []);
  const open = all.filter((c) => !c.passed && fits(c.slot, filter));

  const remaining = new Map<string, number>();
  for (const c of open) remaining.set(c.issue.id, (remaining.get(c.issue.id) ?? 0) + 1);

  const members = new Map<string, Candidate[]>();
  for (const c of all) {
    if (c.groupId) members.set(c.groupId, [...(members.get(c.groupId) ?? []), c]);
  }

  // One card per event: the fullest open story stands for its group.
  const shown: Candidate[] = [];
  const standing = new Map<string, Candidate>();
  for (const c of open) {
    if (!c.groupId) {
      shown.push(c);
      continue;
    }
    const current = standing.get(c.groupId);
    if (!current) {
      standing.set(c.groupId, c);
      shown.push(c);
    } else if (fullness(c) > fullness(current)) {
      standing.set(c.groupId, c);
      shown[shown.indexOf(current)] = c;
    }
  }

  const interest = signals ? interestModel(signals.interest ?? []) : null;
  const now = signals?.now ?? Date.now();

  const cards = shown.map((c) => {
    const sender = byId.get(c.issue.senderId) ?? null;
    const from = sender ? senderLabel(sender) : null;
    const others = (c.groupId ? (members.get(c.groupId) ?? []) : []).filter(
      (m) => m.issue.senderId !== c.issue.senderId,
    );
    const alsoIn: AlsoIn[] = [];
    for (const m of others) {
      if (alsoIn.some((a) => a.issueId === m.issue.id)) continue;
      const other = byId.get(m.issue.senderId);
      if (alsoIn.some((a) => a.from === (other ? senderLabel(other) : ''))) continue;
      alsoIn.push({ issueId: m.issue.id, from: other ? senderLabel(other) : 'Unknown sender' });
    }
    const repeats = (c.groupId ? (members.get(c.groupId) ?? []) : [])
      .filter((m) => m !== c && !m.passed)
      .map((m) => ({ issueId: m.issue.id, storyIndex: m.slot.storyIndex }));

    const newsletters = 1 + alsoIn.length;
    const topic = topicOf(c.slot);
    const topicLean = interest?.topic(topic) ?? 0;
    const senderLean = interest?.sender(c.issue.senderId) ?? 0;
    const score = interest
      ? storyScore(
          {
            receivedAt: c.issue.receivedAt,
            newsletters,
            lead: c.slot.readIndex === 0 && slots(c.issue).length > 1,
            topicLean,
            senderLean,
          },
          now,
        )
      : 0;

    const card: QuickCard = {
      ...c.slot.body,
      issueId: c.issue.id,
      storyIndex: c.slot.storyIndex,
      subject: c.issue.subject,
      receivedAt: c.issue.receivedAt,
      sender,
      from,
      remainingInIssue: remaining.get(c.issue.id) ?? 1,
      alsoIn,
      repeats,
      reason: interest ? rankReason({ newsletters, topic, topicLean, from, senderLean }) : null,
    };
    return { card, score, order: c.order };
  });

  return cards.sort((a, b) => b.score - a.score || a.order - b.order).map(({ card }) => card);
}

/**
 * The story Quick read shows next, or null when you are caught up.
 *
 * A newsletter from a muted sender is left out, as are stories already
 * passed, stories whose event was passed from another newsletter, and
 * newsletters that have not been summarised. `filter` narrows it further;
 * `remainingInIssue` then counts only the cards that fit it. The order is
 * rankedCards': #846's newest-first without `signals`, ranked with them.
 */
export function nextCard(
  issues: readonly QuickIssue[],
  senders: readonly NewsSender[],
  passes: readonly StoryPass[],
  filter: QuickFilter = {},
  signals?: QuickSignals,
): QuickCard | null {
  return rankedCards(issues, senders, passes, filter, signals)[0] ?? null;
}

/** How many stories a laptop page of Quick read holds at most. */
export const QUICK_PAGE_SIZE = 5;

/** The passes Next records for a card: its own, and its event's repeats. */
export function cardPasses(card: QuickCard): StoryPass[] {
  return [{ issueId: card.issueId, storyIndex: card.storyIndex }, ...card.repeats];
}

/**
 * The stories a laptop page of Quick read shows, or an empty list when you
 * are caught up.
 *
 * They are the cards nextCard would show one at a time, in that order, found
 * by asking nextCard again as though each card before had been passed, so the
 * muting, topic, hidden-topic and pass rules are the same ones and
 * `remainingInIssue` on each card is what nextCard would have said when it
 * got there. The first story with a picture is then moved to the front to
 * lead the page; when none has a picture the order is left alone. With fewer
 * than `size` cards left the page is shorter.
 */
export function quickPage(
  issues: readonly QuickIssue[],
  senders: readonly NewsSender[],
  passes: readonly StoryPass[],
  filter: QuickFilter = {},
  size: number = QUICK_PAGE_SIZE,
  signals?: QuickSignals,
): QuickCard[] {
  const cards: QuickCard[] = [];
  const seen: StoryPass[] = [...passes];
  while (cards.length < size) {
    const card = nextCard(issues, senders, seen, filter, signals);
    if (!card) break;
    cards.push(card);
    seen.push(...cardPasses(card));
  }
  const lead = cards.findIndex((card) => card.kind === 'story' && Boolean(card.story.image));
  if (lead > 0) cards.unshift(...cards.splice(lead, 1));
  return cards;
}

/**
 * The topics Quick read has a story left on, in NEWS_TOPICS order: the chips
 * drawn above the card. Muted senders and passed stories do not count, the
 * same as for nextCard, so every chip leads to at least one card. A hidden
 * topic gets no chip, since nextCard would show nothing under it.
 */
export function quickTopics(
  issues: readonly QuickIssue[],
  senders: readonly NewsSender[],
  passes: readonly StoryPass[],
  hidden: readonly NewsTopic[] = [],
  groups: readonly StoryGroupRow[] = [],
): NewsTopic[] {
  const byId = new Map(senders.map((sender) => [sender.id, sender]));
  const found = new Set<NewsTopic>();
  for (const c of candidates(issues, byId, passes, groups)) {
    const topic = topicOf(c.slot);
    if (!c.passed && topic) found.add(topic);
  }
  return NEWS_TOPICS.filter((topic) => found.has(topic) && !hidden.includes(topic));
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
