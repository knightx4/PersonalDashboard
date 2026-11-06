/**
 * Texts sent in a row are one turn (plan #2988). A direct chat's reply
 * (lib/you/mentor-reply.ts) and a group's burst (lib/you/group-burst.ts)
 * both hold the chat's lease while they work; these are the two pieces they
 * share, with no reads or writes of their own.
 *
 * Why a message used to go unanswered, as the thread of 5 November 2026
 * showed: a text sent while the reply was still being thought about was
 * saved before the reply's first bubble, so the thread then ended on the
 * mentor, and the follow-up round read that as nothing left to answer. The
 * message sat with no reply and nothing running until the person sent one
 * more. A reply now answers every message of theirs that no reply has read
 * yet (`delivered_at` still empty), moved to the end of what the model
 * reads, and marks delivered only the messages it read.
 */

/** How long the person has to stop sending before the reply reads the thread: about the pause between texts in a row. */
export const SETTLE_QUIET_MS = 2_500;
/** The longest a reply waits for the person to stop; past it the reply goes and a follow-up round takes the rest. */
export const SETTLE_MAX_MS = 10_000;

/**
 * How much longer to wait before replying, given when the person's newest
 * message was saved and how long the reply has waited already: zero once
 * they have been quiet for SETTLE_QUIET_MS or the reply has waited
 * SETTLE_MAX_MS. Never longer than one quiet spell, so a database clock
 * ahead of this one cannot hold a reply up.
 */
export function settleWaitMs(newestAt: string | null, now: number, waited: number, quietMs = SETTLE_QUIET_MS, maxMs = SETTLE_MAX_MS): number {
  if (!newestAt) return 0;
  const at = Date.parse(newestAt);
  if (!Number.isFinite(at)) return 0;
  const left = maxMs - waited;
  if (left <= 0) return 0;
  const quiet = quietMs - (now - at);
  if (quiet <= 0) return 0;
  return Math.min(quiet, quietMs, left);
}

/**
 * Wait until the person has stopped sending: reads their newest message's
 * time, sleeps what `settleWaitMs` says, and reads again, until it says zero.
 * The caller holds the lease, so the thread shows typing all the while.
 */
export async function waitForQuiet(
  newestAt: () => Promise<string | null>,
  clock: { now: () => number; sleep: (ms: number) => Promise<void> },
  quietMs = SETTLE_QUIET_MS,
  maxMs = SETTLE_MAX_MS,
): Promise<void> {
  let waited = 0;
  for (;;) {
    const wait = settleWaitMs(await newestAt(), clock.now(), waited, quietMs, maxMs);
    if (wait <= 0) return;
    await clock.sleep(wait);
    waited += wait;
  }
}

/**
 * The person's messages moved after everything else, oldest first, when a
 * reply has not read them yet. A text sent while the last reply was being
 * written sits before that reply's bubbles; read in place, the thread would
 * end on the mentor and the text would look answered.
 */
export function waitingLast<T extends { id: string; role: string }>(messages: readonly T[], waiting: ReadonlySet<string>): T[] {
  if (waiting.size === 0) return [...messages];
  const held = messages.filter((m) => m.role === 'person' && waiting.has(m.id));
  return [...messages.filter((m) => !held.includes(m)), ...held];
}

/**
 * Renew a lease on a timer, and let go of it cleanly: `stop` clears the
 * timer and waits for a renewal already sent, so none lands after the
 * release. One that did used to put the typing dots back for twelve
 * seconds, and a text sent in them found the chat held by a run that had
 * already ended.
 */
export function keepRenewing(renew: () => Promise<unknown>, everyMs: number): { stop: () => Promise<void> } {
  let inFlight: Promise<unknown> = Promise.resolve();
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    inFlight = renew().catch(() => undefined);
  }, everyMs);
  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await inFlight;
    },
  };
}

/** How long a text of theirs may wait with no reply and nothing writing one before the thread asks for one. */
export const STALLED_MS = 60_000;
/** Older than this, a text left unanswered is history, not a reply that went missing. */
export const STALLED_LIMIT_MS = 24 * 60 * 60_000;

/**
 * The text of theirs a thread is still owed a reply to, for the safety net
 * (plan #2988): the newest message when it is theirs, or the newest of theirs
 * no reply has read. Null when every text has been answered.
 */
export function owedReply<T extends { id: string; role: string; createdAt: string; deliveredAt?: string | null }>(messages: readonly T[]): T | null {
  const last = messages.at(-1);
  if (!last) return null;
  if (last.role === 'person') return last;
  return messages.findLast((m) => m.role === 'person' && !m.deliveredAt) ?? null;
}
