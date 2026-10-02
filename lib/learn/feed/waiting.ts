/**
 * What is waiting for you, as the strip at the top of Learn's Now tab lists it
 * (plan #1311, moved from the Home tab by plan #1486): one line each for ideas
 * due for review, readings you said you would read, and goals with no plan
 * yet, each linking to where you deal with it.
 *
 * Cards ready in the feed are left off, since the feed is the page the strip
 * sits on. Tracks and quizzes are left off because neither has a number that
 * says something is waiting.
 *
 * The page supplies one read per count. They run in parallel, and a read that
 * fails leaves its count null, which drops that line and nothing else.
 */

export type WaitingKey = 'reviews' | 'readings' | 'goals';

/** A count that could not be read is null. */
export type WaitingCounts = Record<WaitingKey, number | null>;

export type WaitingReads = Record<WaitingKey, () => Promise<number>>;

export type WaitingLine = { key: WaitingKey; text: string; href: string };

const ORDER: readonly WaitingKey[] = ['reviews', 'readings', 'goals'];

/** Each count read in parallel; a read that throws gives null for its own count only. */
export async function readWaiting(reads: WaitingReads): Promise<WaitingCounts> {
  const settled = await Promise.allSettled(ORDER.map((key) => reads[key]()));
  const counts = {} as WaitingCounts;
  ORDER.forEach((key, index) => {
    const result = settled[index];
    counts[key] = result.status === 'fulfilled' ? result.value : null;
  });
  return counts;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The reviews and readings are listed further down Now itself, so their lines
 * jump to those lists; from the Practice only view the same links bring the
 * feed back with the list in view.
 */
export const WAITING_ANCHORS = { reviews: 'due-for-review', readings: 'read-these' } as const;

const LINES: Record<WaitingKey, { text: (count: number) => string; href: string }> = {
  reviews: {
    text: (n) => `${plural(n, 'idea', 'ideas')} due for review`,
    href: `/learn/now#${WAITING_ANCHORS.reviews}`,
  },
  readings: {
    text: (n) => `${plural(n, 'reading', 'readings')} you said you would read`,
    href: `/learn/now#${WAITING_ANCHORS.readings}`,
  },
  goals: { text: (n) => `${plural(n, 'goal', 'goals')} without a plan yet`, href: '/learn/goals' },
};

/** The lines to show, in a fixed order, leaving out any count that is zero or unread. */
export function waitingLines(counts: WaitingCounts): WaitingLine[] {
  return ORDER.flatMap((key) => {
    const count = counts[key];
    if (count === null || count <= 0) return [];
    return [{ key, text: LINES[key].text(count), href: LINES[key].href }];
  });
}

/**
 * What the strip says when no line shows: `nothing` only when every count was read
 * and each is zero, `unread` when at least one could not be read (so "nothing
 * is waiting" would be a guess), and null when there are lines to show.
 */
export function waitingEmpty(counts: WaitingCounts): 'nothing' | 'unread' | null {
  if (waitingLines(counts).length > 0) return null;
  return ORDER.some((key) => counts[key] === null) ? 'unread' : 'nothing';
}

/** Goals with no plan: the active aims whose id no plan names. */
export function countGoalsWithoutPlan(
  aims: readonly { id: string }[],
  plans: readonly { aimId: string }[],
): number {
  const planned = new Set(plans.map((plan) => plan.aimId));
  return aims.filter((aim) => !planned.has(aim.id)).length;
}
