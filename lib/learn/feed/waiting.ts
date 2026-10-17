/**
 * What is waiting for you, as Learn's Now lists it (plan #1311, moved from
 * the Home tab by plan #1486): one line each for what is on you in Learn's
 * inbox, ideas due for review, readings you said you would read, and the
 * cards written before Now led with today's piece (plan #2313.1), each
 * linking to where you deal with it.
 *
 * Goals without a plan are left off since plan #2313.1: a subject you add is
 * prepared on its own, so a goal has nothing to wait on you for here. Tracks
 * and quizzes are left off because neither has a number that says something
 * is waiting. The cards line goes once the last card is answered.
 *
 * The page supplies one read per count. They run in parallel, and a read that
 * fails leaves its count null, which drops that line and nothing else.
 */

export type WaitingKey = 'inbox' | 'reviews' | 'readings' | 'cards';

/** A count that could not be read is null. */
export type WaitingCounts = Record<WaitingKey, number | null>;

export type WaitingReads = Record<WaitingKey, () => Promise<number>>;

export type WaitingLine = { key: WaitingKey; text: string; href: string };

const ORDER: readonly WaitingKey[] = ['inbox', 'reviews', 'readings', 'cards'];

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
 * jump to those lists; from the Practice view the same links bring Now back
 * with the list in view.
 */
export const WAITING_ANCHORS = { reviews: 'due-for-review', readings: 'read-these' } as const;

/** The cards written before Now changed, as a page of their own (plan #2313.1). */
export const CARDS_HREF = '/learn/now?cards=1';

const LINES: Record<WaitingKey, { text: (count: number) => string; href: string }> = {
  inbox: { text: (n) => `${plural(n, 'thing', 'things')} in your inbox`, href: '/learn/inbox' },
  reviews: {
    text: (n) => `${plural(n, 'idea', 'ideas')} due for review`,
    href: `/learn/now#${WAITING_ANCHORS.reviews}`,
  },
  readings: {
    text: (n) => `${plural(n, 'reading', 'readings')} you said you would read`,
    href: `/learn/now#${WAITING_ANCHORS.readings}`,
  },
  cards: { text: (n) => `${plural(n, 'card', 'cards')} from before`, href: CARDS_HREF },
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
 * What the list says when no line shows: `nothing` only when every count was read
 * and each is zero, `unread` when at least one could not be read (so "nothing
 * is waiting" would be a guess), and null when there are lines to show.
 */
export function waitingEmpty(counts: WaitingCounts): 'nothing' | 'unread' | null {
  if (waitingLines(counts).length > 0) return null;
  return ORDER.some((key) => counts[key] === null) ? 'unread' : 'nothing';
}
