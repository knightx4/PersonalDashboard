import { readTopic, type NewsTopic } from '@/lib/news/issues/topics';

/**
 * How Quick read decides which story matters most to you.
 *
 * Quick read used to take the newest newsletter first and its stories in the
 * email's order (#846). With a dozen newsletters a day that put whatever
 * arrived last ahead of the event half of them led with, and showed that event
 * again from each newsletter that covered it. This ranks every story left
 * across them instead, from four things:
 *
 * - How new it is. A story halves in weight every FRESH_HALF_LIFE_HOURS.
 * - How many of your newsletters ran it. Each one past the first adds
 *   COVERAGE_STEP, up to COVERAGE_CAP: an event five of them led with is
 *   worth reading a day later.
 * - Whether it led its newsletter. The editor put it first for a reason.
 * - What you read. Opening a story's article or saving it counts for its
 *   topic and its newsletter; moving past one without opening counts
 *   slightly against. `interestModel` turns those tallies into a lean of at
 *   most INTEREST_CAP each way, and applies none until you have opened or
 *   saved MIN_ENGAGED stories, so one click does not reorder the feed.
 *
 * Everything here is pure, so the order can be tested without a database.
 */

export const FRESH_HALF_LIFE_HOURS = 24;
export const COVERAGE_STEP = 0.6;
export const COVERAGE_CAP = 1.8;
export const LEAD_BONUS = 0.2;
export const INTEREST_CAP = 0.4;
export const MIN_ENGAGED = 3;

/** How strongly a tally has to lean before the card says so. */
export const REASON_LEAN = 0.15;

/**
 * A row of news.story_interest (supabase/migrations-news/0013_story_interest.sql):
 * for one newsletter and topic, the stories you moved past, opened and saved.
 */
export type InterestRow = {
  senderId: string;
  topic: string | null;
  seen: number;
  opened: number;
  saved: number;
};

/** How much you lean towards or away from a topic and a newsletter, each within ±INTEREST_CAP. */
export type InterestModel = {
  topic: (topic: NewsTopic | undefined) => number;
  sender: (senderId: string) => number;
};

const NO_LEAN: InterestModel = { topic: () => 0, sender: () => 0 };

/** A save says more than an open. */
function engagedOf(row: InterestRow): number {
  return row.opened + 2 * row.saved;
}

/**
 * Leans from the tallies. Each topic's and each newsletter's rate of opens and
 * saves per story seen is compared with your rate over everything, smoothed
 * towards it by SMOOTHING stories so a topic seen twice cannot lean far. A
 * rate twice yours is +0.2, half of it is -0.1: moving past stories you did not
 * open is a weaker sign than opening one, so the lean down is halved.
 */
const SMOOTHING = 20;
const LEAN_PER_DOUBLING = 0.2;

export function interestModel(rows: readonly InterestRow[]): InterestModel {
  let engaged = 0;
  let seen = 0;
  const byTopic = new Map<NewsTopic, { engaged: number; seen: number }>();
  const bySender = new Map<string, { engaged: number; seen: number }>();
  for (const row of rows) {
    const e = engagedOf(row);
    // A saved story you never passed has no pass to count, so it counts once as seen.
    const s = Math.max(row.seen, row.saved);
    engaged += e;
    seen += s;
    const topic = readTopic(row.topic);
    if (topic) add(byTopic, topic, e, s);
    add(bySender, row.senderId, e, s);
  }
  if (engaged < MIN_ENGAGED || seen === 0) return NO_LEAN;

  const base = engaged / seen;
  const lean = (tally: { engaged: number; seen: number } | undefined): number => {
    if (!tally) return 0;
    const rate = (tally.engaged + SMOOTHING * base) / (tally.seen + SMOOTHING);
    const raw = LEAN_PER_DOUBLING * Math.log2(rate / base);
    const softened = raw < 0 ? raw / 2 : raw;
    return Math.max(-INTEREST_CAP, Math.min(INTEREST_CAP, softened));
  };
  return {
    topic: (topic) => (topic ? lean(byTopic.get(topic)) : 0),
    sender: (senderId) => lean(bySender.get(senderId)),
  };
}

function add<K>(map: Map<K, { engaged: number; seen: number }>, key: K, e: number, s: number) {
  const tally = map.get(key) ?? { engaged: 0, seen: 0 };
  tally.engaged += e;
  tally.seen += s;
  map.set(key, tally);
}

/** What a story is scored on. */
export type RankInput = {
  receivedAt: string;
  /** How many different newsletters ran it, this one included. */
  newsletters: number;
  /** Whether it was the first story of a newsletter with more than one. */
  lead: boolean;
  topicLean: number;
  senderLean: number;
};

/** How far up Quick read a story goes. Higher first. */
export function storyScore(input: RankInput, now: number): number {
  const arrived = Date.parse(input.receivedAt);
  const hours = Number.isFinite(arrived) ? Math.max(0, (now - arrived) / 3_600_000) : Infinity;
  const fresh = Number.isFinite(hours) ? 0.5 ** (hours / FRESH_HALF_LIFE_HOURS) : 0;
  const coverage = Math.min(COVERAGE_CAP, COVERAGE_STEP * Math.max(0, input.newsletters - 1));
  return fresh + coverage + (input.lead ? LEAD_BONUS : 0) + input.topicLean + input.senderLean;
}

/**
 * The one line a card gives for why it is near the top, or null when nothing
 * stands out. Coverage by three or more newsletters says it first. Two is
 * already said by the card's "Also in" line.
 */
export function rankReason(input: {
  newsletters: number;
  topic: NewsTopic | undefined;
  topicLean: number;
  from: string | null;
  senderLean: number;
}): string | null {
  if (input.newsletters >= 3) return `Ran in ${input.newsletters} of your newsletters`;
  if (input.topic && input.topic !== 'Other' && input.topicLean >= REASON_LEAN) {
    return `You often open ${input.topic} stories`;
  }
  if (input.from && input.senderLean >= REASON_LEAN) return `You often open ${input.from}`;
  return null;
}
