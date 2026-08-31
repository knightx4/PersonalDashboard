/**
 * Picking a stopped first scan back up.
 *
 * The backfill runs as a chain: one function invocation does about forty-five
 * seconds of work and then hands off to the next over HTTP. Vercel's recursion
 * detection stops that chain after a handful of hops -- the hand-off comes back
 * `508`, the pump gives up, and the job is marked failed with most of the
 * mailbox unread. Six attempts in a row got 34, 74, 54, 66, 60 and 60 messages
 * in, which is that limit and nothing else.
 *
 * A fresh request starts a fresh chain, so the fix at this end is simply to
 * make one: while a page of the app is open, the banner notices a scan that
 * stopped short and starts the next stretch. Nothing here decides *how* to
 * resume -- these are the two questions ("is there more to read?" and "should
 * we ask for it again yet?") pulled out where they can be tested.
 */

export type BackfillJobSnapshot = {
  status: string;
  messagesSeen: number;
};

export type BackfillState = {
  /** Where the account stands: only an active mailbox can be scanned. */
  accountStatus: string;
  /** Set once the whole window has been read. */
  backfillCompletedAt: string | null;
  /** The most recent backfill job for this account, if one was ever started. */
  latestJob: BackfillJobSnapshot | null;
};

const ACTIVE_JOB = new Set(['queued', 'running']);

/** A scan is under way right now, so nothing should start another. */
export function backfillRunning(state: BackfillState): boolean {
  return state.latestJob !== null && ACTIVE_JOB.has(state.latestJob.status);
}

/**
 * A first scan was started, read part of the mailbox, and stopped.
 *
 * This is the state the settings page used to describe as "Start the first
 * scan" -- the same words as never having started one, on an account where
 * hundreds of messages had already been read.
 */
export function backfillResumable(state: BackfillState): boolean {
  if (state.accountStatus !== 'active') return false;
  if (state.backfillCompletedAt) return false;
  if (!state.latestJob) return false;
  return !ACTIVE_JOB.has(state.latestJob.status);
}

/** What the button offers, given where the scan actually got to. */
export function scanButtonLabel(state: BackfillState): string {
  if (state.backfillCompletedAt) return 'Re-scan everything';
  return backfillResumable(state) ? 'Resume the first scan' : 'Start the first scan';
}

export type AutoResumeInput = {
  state: BackfillState;
  /**
   * Resumes already sent that read nothing new. Two is the cut-off: one can be
   * a chain that died before its first batch, two in a row is a mailbox that is
   * not going to progress by being asked again.
   */
  stalledAttempts: number;
  /** Milliseconds since the last resume this tab sent, or null if none. */
  sinceLastAttemptMs: number | null;
};

/**
 * Long enough that a resume gets a chain's worth of work done before another
 * is considered, short enough that an hour-long mailbox is not spent waiting.
 */
export const RESUME_COOLDOWN_MS = 20_000;

export const MAX_STALLED_RESUMES = 2;

export function shouldAutoResume({
  state,
  stalledAttempts,
  sinceLastAttemptMs,
}: AutoResumeInput): boolean {
  if (!backfillResumable(state)) return false;
  if (backfillRunning(state)) return false;
  if (stalledAttempts >= MAX_STALLED_RESUMES) return false;
  if (sinceLastAttemptMs !== null && sinceLastAttemptMs < RESUME_COOLDOWN_MS) return false;
  return true;
}
