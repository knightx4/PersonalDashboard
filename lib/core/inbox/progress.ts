/**
 * What a mailbox check is doing, in a bar and a sentence.
 *
 * "Started. Progress appears in the banner at the top." was the entirety of
 * what Check now said, and the banner only appears while a job is mid-flight,
 * which a short check often is not by the time the page repaints. So the
 * honest reading of the button was that clicking it did nothing.
 *
 * A run has four steps and only one of them has a count worth showing, so the
 * bar is a weighted mix: the phases carry it while nothing is countable, and
 * the message count carries it through the long middle. The alternative --
 * seen over total for the whole run -- sits at zero through the listing and
 * then jumps, which is the thing a progress bar exists not to do.
 */

export const SYNC_PHASES = ['listing', 'reading', 'linking', 'done'] as const;

export type SyncPhase = (typeof SYNC_PHASES)[number];

export function isSyncPhase(value: unknown): value is SyncPhase {
  return typeof value === 'string' && (SYNC_PHASES as readonly string[]).includes(value);
}

export interface SyncSnapshot {
  /** queued | running | completed | failed. */
  status: string;
  phase: SyncPhase | null;
  messagesSeen: number;
  messagesParsed: number;
  /** What the list step found, where it is a whole run's worth. */
  messagesTotal: number | null;
  error?: string | null;
}

export interface SyncProgressView {
  /** 0 to 1, for the width of the bar. */
  fraction: number;
  /** One line saying what is happening, in the present tense while it is. */
  detail: string;
  /** Whether the run is over, however it ended. */
  done: boolean;
  failed: boolean;
}

/** Where each phase starts, as a share of the whole run. */
const PHASE_START: Record<SyncPhase, number> = {
  listing: 0.04,
  reading: 0.12,
  linking: 0.78,
  done: 1,
};

/** The share of the bar the message count is allowed to move. */
const READING_SPAN = PHASE_START.linking - PHASE_START.reading;

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export function syncProgress(job: SyncSnapshot): SyncProgressView {
  const finished = job.status === 'completed' || job.status === 'failed';

  if (job.status === 'failed') {
    return {
      fraction: 1,
      detail: job.error?.trim() || 'The check stopped before it finished.',
      done: true,
      failed: true,
    };
  }

  if (job.status === 'completed') {
    return {
      fraction: 1,
      detail:
        job.messagesSeen === 0
          ? 'Nothing new since the last check.'
          : `Done — ${plural(job.messagesSeen, 'message')} read, ${job.messagesParsed} linked.`,
      done: true,
      failed: false,
    };
  }

  const phase: SyncPhase = job.phase && !finished ? job.phase : 'listing';

  if (phase === 'reading') {
    const total = job.messagesTotal ?? 0;
    const share = total > 0 ? Math.min(1, job.messagesSeen / total) : 0;
    return {
      fraction: PHASE_START.reading + READING_SPAN * share,
      detail:
        total > 0
          ? `Reading ${job.messagesSeen} of ${plural(total, 'message')}.`
          : 'Reading what it found.',
      done: false,
      failed: false,
    };
  }

  if (phase === 'linking') {
    return {
      fraction: PHASE_START.linking,
      detail:
        job.messagesSeen > 0
          ? `Sorting ${plural(job.messagesSeen, 'message')} into roles.`
          : 'Sorting what it read into roles.',
      done: false,
      failed: false,
    };
  }

  if (phase === 'done') {
    // The row says the work is over and the status has not caught up yet.
    return { fraction: 0.98, detail: 'Finishing up.', done: false, failed: false };
  }

  return {
    fraction: PHASE_START.listing,
    detail: 'Looking for mail you have not seen yet.',
    done: false,
    failed: false,
  };
}
