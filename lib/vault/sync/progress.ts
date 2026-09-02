/**
 * How far the vault sync has actually got, as a bar and a sentence.
 *
 * The settings page used to say two things: a "last synced" timestamp and
 * "Still working through the vault". Both are true and neither answers the
 * question you actually have during a first sync of a few thousand notes,
 * which is "is this moving, and how much is left".
 *
 * The total comes out of the run log rather than being stored: a backfill run
 * records `notes_seen` as the size of the whole tree it walked, including the
 * runs that stopped early, so the most recent backfill knows how many notes
 * the vault has. Mirrored is a count of the rows. Neither is an estimate.
 *
 * Pure on purpose -- everything it reasons about is passed in, so the rules
 * for "running", "stalled" and "done" are testable without a database.
 */

export type SyncRunSummary = {
  id: string;
  type: 'backfill' | 'incremental';
  status: 'queued' | 'running' | 'completed' | 'failed';
  notesSeen: number;
  notesWritten: number;
  notesDeleted: number;
  notesSkipped: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
};

export type SyncPhase =
  | 'never_run'
  /** A first sync, part way through: the bar is the one that matters. */
  | 'first_sync'
  | 'running'
  | 'up_to_date'
  | 'failed';

export type SyncProgress = {
  phase: SyncPhase;
  /** Notes currently mirrored. */
  mirrored: number;
  /** Notes in the vault, when a backfill has counted them. */
  total: number | null;
  /** 0-100, or null when there is nothing to divide by. */
  percent: number | null;
  headline: string;
  detail: string;
};

/**
 * A run counts as in flight until it says otherwise.
 *
 * There is deliberately no staleness cut-off here. A run that died without
 * writing its row would show as running forever, but the sync writes its
 * failure in a catch block and the cron re-runs on a schedule -- inventing a
 * timeout would mean this screen calling a run dead while it is still working.
 */
function isActive(run: SyncRunSummary): boolean {
  return run.status === 'running' || run.status === 'queued';
}

export function syncProgress(input: {
  /** Notes not soft-deleted. */
  mirrored: number;
  backfillCompletedAt: string | null;
  /** Most recent first. */
  runs: readonly SyncRunSummary[];
}): SyncProgress {
  const { mirrored, backfillCompletedAt, runs } = input;
  const latest = runs[0] ?? null;
  const latestBackfill = runs.find((run) => run.type === 'backfill') ?? null;

  // During a first sync the tree size is the target. Once it is done, the
  // target is what we hold: an incremental run's notes_seen counts only what
  // changed, and using it would make a quiet day look like a vault of four.
  const total = backfillCompletedAt
    ? mirrored
    : latestBackfill && latestBackfill.notesSeen > 0
      ? Math.max(latestBackfill.notesSeen, mirrored)
      : null;

  // The bar measures the mirror, not the last run: a vault fully mirrored
  // whose nightly update failed is still fully mirrored, and the headline is
  // where that failure gets said.
  const percent = total && total > 0 ? Math.min(100, Math.round((mirrored / total) * 100)) : null;

  if (!latest) {
    return {
      phase: 'never_run',
      mirrored,
      total,
      percent: null,
      headline: 'Waiting for the first sync',
      detail: 'Syncing runs once a day. Nothing has been read from the repository yet.',
    };
  }

  if (isActive(latest)) {
    return {
      phase: 'running',
      mirrored,
      total,
      percent,
      headline: latest.type === 'backfill' ? 'First sync running' : 'Syncing',
      detail:
        total === null
          ? `${mirrored} ${plural(mirrored, 'note')} mirrored so far.`
          : `${mirrored} of ${total} notes mirrored.`,
    };
  }

  if (latest.status === 'failed') {
    return {
      phase: 'failed',
      mirrored,
      total,
      percent,
      headline: 'Last sync failed',
      detail: latest.error ?? 'The run stopped without saying why.',
    };
  }

  if (!backfillCompletedAt) {
    return {
      phase: 'first_sync',
      mirrored,
      total,
      percent,
      headline: 'First sync in progress',
      detail:
        total === null
          ? `${mirrored} ${plural(mirrored, 'note')} mirrored. The next run continues where this one stopped.`
          : `${mirrored} of ${total} notes mirrored. The next run continues where this one stopped.`,
    };
  }

  return {
    phase: 'up_to_date',
    mirrored,
    total,
    percent,
    headline: 'Up to date',
    detail: describeRun(latest),
  };
}

/** What one finished run actually did, in the fewest words that stay true. */
export function describeRun(run: SyncRunSummary): string {
  if (run.status === 'failed') return run.error ?? 'Failed without saying why.';
  if (isActive(run)) return 'Running now.';

  const parts: string[] = [];
  if (run.notesWritten) parts.push(`${run.notesWritten} ${plural(run.notesWritten, 'note')} updated`);
  if (run.notesDeleted) parts.push(`${run.notesDeleted} removed`);
  if (run.notesSkipped) parts.push(`${run.notesSkipped} skipped`);
  return parts.length === 0 ? 'Nothing had changed.' : `${parts.join(', ')}.`;
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}
