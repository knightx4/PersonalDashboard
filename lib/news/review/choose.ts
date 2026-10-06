import type { NewsSender } from '@/lib/news/issues/list';
import type { NewsStory } from '@/lib/news/issues/stories';
import type { NewsTopic } from '@/lib/news/issues/topics';
import { slots, storyFullness, type QuickIssue, type StoryGroupRow } from '@/lib/news/quick/next';

/**
 * Choosing the stories for the daily review (plan #1614, under #1612).
 *
 * Each evening Dash writes a review of the day's newsletters: a short
 * overview, then the most important stories in one line each. This picks
 * those stories. The cron that writes the review (#1615) loads the day's
 * newsletters, calls chooseReviewStories, asks the model for the overview and
 * one line per pick, and stores reviewItem(pick, line) in
 * news.daily_reviews.items (supabase/migrations-news/0019_daily_reviews.sql).
 *
 * It works from what Quick read already uses: the newsletters as stored
 * (QuickIssue), the senders for muting, news.story_groups for which stories
 * are the same event, and the topics put aside with Fewer like this.
 */

/** How far back the review looks: the 24 hours before it is written. */
export const REVIEW_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The most stories the review lists, before the local story. */
export const REVIEW_MAX_STORIES = 10;

/** The topic a story about the person's own area is tagged with (topics.ts). */
const LOCAL_TOPIC: NewsTopic = 'Local';

export type ReviewInput = {
  /** The summarised news-purpose newsletters; the ones outside the window are skipped here. */
  issues: readonly QuickIssue[];
  /** Every sender, so a muted one's newsletters are left out as Quick read leaves them out. */
  senders: readonly NewsSender[];
  /** news.story_groups rows for these newsletters, numbered among the readable stories. */
  groups: readonly StoryGroupRow[];
  /** The topics hidden with Fewer like this (news.hidden_topics). */
  hidden: readonly NewsTopic[];
  /** When the review is written. It covers the 24 hours up to and including this moment. */
  until: Date;
};

/**
 * One story the review lists, in the order it lists them.
 *
 * `issueId` and `storyIndex` are the telling the line opens: storyIndex is the
 * position in the stored news.issues.stories array, the same numbering as
 * news.story_passes. `summary` is that telling's summary, for the model to
 * write the one line from. `sources` is how many newsletters ran the event.
 * `rating` is the highest rating any telling got, absent while none is
 * rated. `local` marks the review's one Local story.
 */
export type ReviewPick = {
  issueId: string;
  storyIndex: number;
  headline: string;
  summary: string;
  sources: number;
  rating?: number;
  topic?: NewsTopic;
  local?: true;
};

/** One entry of news.daily_reviews.items, as #1613 settled its shape. */
export type ReviewItem = {
  issue_id: string;
  story_index: number;
  headline: string;
  line: string;
  sources: number;
  local?: true;
};

type Telling = {
  issue: QuickIssue;
  storyIndex: number;
  story: NewsStory;
  /** Its place across the day, newest newsletter first and each in the email's order. */
  order: number;
};

type Event = {
  tellings: Telling[];
  rating?: number;
  sources: number;
  /** The telling that stands for the event. */
  lead: Telling;
};

function arrivalOf(issue: QuickIssue): number {
  const time = Date.parse(issue.receivedAt);
  return Number.isFinite(time) ? time : Number.NaN;
}

/**
 * Every story the day's newsletters told, newest newsletter first: muted
 * senders, newsletters outside the window and stories from a hidden topic
 * left out. A newsletter that is one essay has no story to list, so it makes
 * none here.
 */
function tellings(input: ReviewInput): Telling[] {
  const end = input.until.getTime();
  const start = end - REVIEW_WINDOW_MS;
  const muted = new Set(input.senders.filter((s) => s.muted).map((s) => s.id));
  const hidden = new Set(input.hidden);

  const day = input.issues
    .map((issue, given) => ({ issue, given, arrival: arrivalOf(issue) }))
    .filter(({ issue, arrival }) => arrival > start && arrival <= end && !muted.has(issue.senderId))
    .sort((a, b) => b.arrival - a.arrival || a.given - b.given);

  const found: Telling[] = [];
  for (const { issue } of day) {
    for (const slot of slots(issue)) {
      if (slot.body.kind !== 'story') continue;
      const { story } = slot.body;
      if (story.topic && hidden.has(story.topic)) continue;
      found.push({ issue, storyIndex: slot.storyIndex, story, order: found.length });
    }
  }
  return found;
}

/** The readable-story position each telling is grouped under, keyed as story_groups keys it. */
function groupKeys(issue: QuickIssue): Map<number, number> {
  const keys = new Map<number, number>();
  for (const slot of slots(issue)) {
    if (slot.readIndex !== null) keys.set(slot.storyIndex, slot.readIndex);
  }
  return keys;
}

/**
 * The day's tellings as events: the stories news.story_groups puts in one
 * group become one event, and a story in no group is an event of its own.
 */
function events(all: readonly Telling[], groups: readonly StoryGroupRow[]): Event[] {
  const groupOf = new Map(groups.map((row) => [`${row.issueId}:${row.storyIndex}`, row.groupId]));
  const readIndex = new Map<string, Map<number, number>>();
  const byGroup = new Map<string, Telling[]>();
  const order: Telling[][] = [];

  for (const t of all) {
    let keys = readIndex.get(t.issue.id);
    if (!keys) readIndex.set(t.issue.id, (keys = groupKeys(t.issue)));
    const groupId = groupOf.get(`${t.issue.id}:${keys.get(t.storyIndex)}`);
    if (!groupId) {
      order.push([t]);
      continue;
    }
    const members = byGroup.get(groupId);
    if (members) members.push(t);
    else {
      const fresh = [t];
      byGroup.set(groupId, fresh);
      order.push(fresh);
    }
  }

  return order.map((members) => {
    let rating: number | undefined;
    for (const m of members) {
      const r = m.story.rating;
      if (r !== undefined && (rating === undefined || r > rating)) rating = r;
    }
    return {
      tellings: members,
      rating,
      sources: new Set(members.map((m) => m.issue.senderId)).size,
      lead: leadOf(members),
    };
  });
}

/**
 * Which telling the line opens: the highest rated, then the fullest
 * (storyFullness, as Quick read chooses), then the newest.
 */
function leadOf(members: readonly Telling[]): Telling {
  return [...members].sort(
    (a, b) =>
      (b.story.rating ?? -1) - (a.story.rating ?? -1) ||
      storyFullness(b.story) - storyFullness(a.story) ||
      a.order - b.order,
  )[0];
}

/**
 * Most important first: the highest rating, an unrated event after every
 * rated one; then the event more newsletters ran; then the newest; then the
 * email's own order.
 */
function byImportance(a: Event, b: Event): number {
  return (
    (b.rating ?? -1) - (a.rating ?? -1) ||
    b.sources - a.sources ||
    a.tellings[0].order - b.tellings[0].order
  );
}

function isLocal(event: Event): boolean {
  return event.tellings.some((t) => t.story.topic === LOCAL_TOPIC);
}

function toPick(event: Event, local: boolean): ReviewPick {
  const { lead } = event;
  return {
    issueId: lead.issue.id,
    storyIndex: lead.storyIndex,
    headline: lead.story.headline,
    summary: lead.story.summary,
    sources: event.sources,
    ...(event.rating !== undefined && { rating: event.rating }),
    ...(lead.story.topic && { topic: lead.story.topic }),
    ...(local && { local: true as const }),
  };
}

/**
 * The stories the day's review lists, most important first.
 *
 * Each event appears once, however many newsletters ran it. At most ten are
 * kept. The review's Local story is the highest-rated event tagged Local:
 * when one made the ten it is marked where it stands, and otherwise it is
 * added after them as an eleventh. A day with no newsletters gives an empty
 * list, which #1615 takes as no review to write.
 */
export function chooseReviewStories(input: ReviewInput): ReviewPick[] {
  const ranked = events(tellings(input), input.groups).sort(byImportance);
  const top = ranked.slice(0, REVIEW_MAX_STORIES);
  const local = ranked.find(isLocal);
  const picks = top.map((event) => toPick(event, event === local));
  if (local && !top.includes(local)) picks.push(toPick(local, true));
  return picks;
}

/** A pick and the line written for it, as one entry of news.daily_reviews.items. */
export function reviewItem(pick: ReviewPick, line: string): ReviewItem {
  return {
    issue_id: pick.issueId,
    story_index: pick.storyIndex,
    headline: pick.headline,
    line,
    sources: pick.sources,
    ...(pick.local && { local: true as const }),
  };
}
