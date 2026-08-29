/**
 * Deciding whether there is time for another batch.
 *
 * The sync runs as a chain of function invocations: each one works until it is
 * nearly out of time, then calls the next. The hand-off is the last thing it
 * does, so being killed mid-batch does not just lose that batch -- it loses
 * the chain. The job stays queued, nothing continues it, and some minutes
 * later it is marked "stalled". Nothing in that path looks like a crash, which
 * is why an import that stopped after fifty messages read as an import that
 * merely did not find much.
 *
 * So the test is not "is there time left" but "is there time for a whole
 * batch, and the hand-off after it". Batch cost is measured rather than
 * assumed: it swings with Gmail latency and with how many messages need a
 * model call, and any fixed guess would be wrong in one direction or the
 * other within a week.
 *
 * Kept out of the pump module so it can be tested without a Supabase client, a
 * Gmail token, or a running clock.
 */

/**
 * Never begin a batch with less than this left, however fast the last one was.
 * The first batch of an invocation has nothing measured to reason from.
 */
export const MIN_BATCH_RESERVE_MS = 15_000;

/** How much slower than the worst batch so far the next one may be. */
export const BATCH_SLOWDOWN_ALLOWANCE = 1.3;

export function nextBatchNeedsMs(slowestBatchMs: number): number {
  if (!Number.isFinite(slowestBatchMs) || slowestBatchMs <= 0) {
    return MIN_BATCH_RESERVE_MS;
  }
  return Math.max(
    MIN_BATCH_RESERVE_MS,
    Math.round(slowestBatchMs * BATCH_SLOWDOWN_ALLOWANCE),
  );
}

/**
 * True when another batch fits. False means stop and hand off — which is a
 * normal, successful end to an invocation, not a failure.
 */
export function canStartAnotherBatch(opts: {
  remainingMs: number;
  /** Longest batch seen in this invocation; 0 before the first one. */
  slowestBatchMs: number;
}): boolean {
  return opts.remainingMs >= nextBatchNeedsMs(opts.slowestBatchMs);
}

/**
 * Whether a backfill picks up where it left off.
 *
 * Import used to clear the saved page token every time, so a retry re-paged
 * the mailbox from the top; with the pump dying a page or two in, the same
 * messages were fetched repeatedly and the rest were never reached. Starting
 * over is a separate, explicit action -- Reset & re-scan -- because it also
 * discards what was already imported.
 */
export function shouldResumeBackfill(opts: {
  savedPageToken: string | null | undefined;
  reset?: boolean;
}): boolean {
  return Boolean(opts.savedPageToken) && opts.reset !== true;
}
