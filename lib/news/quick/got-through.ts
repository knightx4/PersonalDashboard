import { formatClock } from '@/lib/clock';
import { safeTimeZone } from '@/lib/core/timezone';
import { senderLabel, type NewsSender } from '@/lib/news/issues/list';
import { readStories } from '@/lib/news/issues/stories';
import type { QuickIssue } from './next';

/**
 * What you got through in Quick read today (plan #1557, docs/UI-QUALITY-SPEC.md
 * Part 8): the card at the end of the deck saying how many stories you read
 * and skipped, the one you stayed on longest, and which newsletters are due
 * next.
 *
 * PURE. Built from today's rows in news.story_passes, which hold only when
 * each story was passed and when its article was opened. There is no read or
 * skipped column (#847 chose one Next button), so both are worked out from
 * the time between passes:
 *
 * - The time on a story is from the pass before it to its own pass. Next page
 *   passes a laptop page's stories in one write, so they share one time, and
 *   the page's time is split between them.
 * - A gap longer than BREAK_MS is a break, not reading, so the story after it
 *   has no time. Nor has the first story of the day.
 * - A story counts as skipped when it was passed in under SKIM_MS and its
 *   article was not opened. Everything else counts as read, including a
 *   story with no time, which is the benefit of the doubt.
 */

/** The calendar day of an instant in a zone, as 2026-10-03. */
function dayIn(zone: string, at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** A pass as the card needs it: when, and whether the article was opened. */
export type TimedPass = {
  issueId: string;
  storyIndex: number;
  passedAt: string;
  openedAt: string | null;
};

/** Under this long on a story, with its article not opened, is a skip. */
export const SKIM_MS = 8_000;

/** Longer than this between passes is a break, and says nothing about the story. */
export const BREAK_MS = 10 * 60_000;

/** Passes written in one go (Next page) land within this of each other. */
const BATCH_MS = 1_000;

export type GotThrough = {
  read: number;
  skipped: number;
  /** The story you stayed on longest, when any story has a time. */
  longest: { headline: string; ms: number } | null;
};

/** Today's passes in the account's zone, oldest first. */
export function passesToday(
  passes: readonly TimedPass[],
  timezone: string,
  now: Date = new Date(),
): TimedPass[] {
  const zone = safeTimeZone(timezone);
  const today = dayIn(zone, now);
  return passes
    .filter((pass) => dayIn(zone, new Date(pass.passedAt)) === today)
    .sort((a, b) => Date.parse(a.passedAt) - Date.parse(b.passedAt));
}

/** The headline of a passed story, or the subject of a one-essay newsletter. */
function headlineOf(issues: ReadonlyMap<string, QuickIssue>, pass: TimedPass): string | null {
  const issue = issues.get(pass.issueId);
  if (!issue) return null;
  const stored = Array.isArray(issue.stories) ? issue.stories : [];
  if (stored.length === 0) return issue.subject;
  const [story] = readStories([stored[pass.storyIndex]]);
  return story?.headline ?? null;
}

/** The time spent on each pass, in the order given; null where it cannot be told. */
export function timeOnEach(passes: readonly TimedPass[]): (number | null)[] {
  const times: (number | null)[] = [];
  let previous: number | null = null;
  let i = 0;
  while (i < passes.length) {
    const start = Date.parse(passes[i].passedAt);
    let end = i + 1;
    while (end < passes.length && Date.parse(passes[end].passedAt) - start <= BATCH_MS) end++;
    const gap = previous === null ? null : start - previous;
    const each = gap === null || gap > BREAK_MS ? null : gap / (end - i);
    for (let k = i; k < end; k++) times.push(each);
    previous = Date.parse(passes[end - 1].passedAt);
    i = end;
  }
  return times;
}

/** How many read and skipped, and the longest, from today's passes oldest first. */
export function gotThrough(
  passes: readonly TimedPass[],
  issues: readonly QuickIssue[],
): GotThrough {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const times = timeOnEach(passes);
  let read = 0;
  let skipped = 0;
  let longest: GotThrough['longest'] = null;
  passes.forEach((pass, index) => {
    const ms = times[index];
    if (ms !== null && ms < SKIM_MS && !pass.openedAt) skipped++;
    else read++;
    if (ms === null || (longest && ms <= longest.ms)) return;
    const headline = headlineOf(byId, pass);
    if (headline) longest = { headline, ms };
  });
  return { read, skipped, longest };
}

/** "40 seconds", "3 minutes": how long the longest story held you. */
export function heldFor(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

/** A newsletter that usually arrives on a rhythm, and when the next one should. */
export type DueNext = { from: string; at: Date };

/** A sender needs this many issues before its rhythm is worth guessing from. */
const RHYTHM_MIN_ISSUES = 3;

/** How many newsletters the card names. */
const DUE_SHOWN = 2;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The newsletters due next, soonest first. Each sender that is not muted and
 * has sent at least three issues is expected again one usual gap (the median
 * between its issues) after its last; a time already past moves on by whole
 * gaps. A sender silent for more than three gaps has stopped, and is left out.
 */
export function dueNext(
  issues: readonly Pick<QuickIssue, 'senderId' | 'receivedAt'>[],
  senders: readonly NewsSender[],
  now: Date = new Date(),
): DueNext[] {
  const byId = new Map(senders.map((sender) => [sender.id, sender]));
  const arrivals = new Map<string, number[]>();
  for (const issue of issues) {
    const at = Date.parse(issue.receivedAt);
    if (!Number.isFinite(at)) continue;
    arrivals.set(issue.senderId, [...(arrivals.get(issue.senderId) ?? []), at]);
  }
  const due: DueNext[] = [];
  for (const [senderId, times] of arrivals) {
    const sender = byId.get(senderId);
    if (!sender || sender.muted || times.length < RHYTHM_MIN_ISSUES) continue;
    times.sort((a, b) => a - b);
    const gap = median(times.slice(1).map((t, i) => t - times[i]));
    if (gap < 60 * 60_000) continue;
    const last = times[times.length - 1];
    if (now.getTime() - last > 3 * gap) continue;
    let next = last + gap;
    while (next <= now.getTime()) next += gap;
    due.push({ from: senderLabel(sender), at: new Date(next) });
  }
  return due.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, DUE_SHOWN);
}

/** "tomorrow around 7:00 AM", "on Friday around 6:30 AM", in the account's zone. */
export function dueWhen(at: Date, timezone: string, now: Date = new Date()): string {
  const zone = safeTimeZone(timezone);
  // Rounded to the half hour: a guess from a rhythm is not to the minute.
  const half = 30 * 60_000;
  const rounded = new Date(Math.round(at.getTime() / half) * half);
  const time = formatClock(rounded, { timeZone: zone });
  const day = dayIn(zone, rounded);
  if (day === dayIn(zone, now)) return `later today around ${time}`;
  if (day === dayIn(zone, new Date(now.getTime() + 86_400_000))) return `tomorrow around ${time}`;
  // Within the week the weekday is enough; further out it needs the date.
  const options: Intl.DateTimeFormatOptions =
    rounded.getTime() - now.getTime() < 6 * 86_400_000
      ? { weekday: 'long', timeZone: zone }
      : { day: 'numeric', month: 'short', timeZone: zone };
  return `on ${new Intl.DateTimeFormat('en-GB', options).format(rounded)} around ${time}`;
}
