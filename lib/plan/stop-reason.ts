/**
 * Why a session stopped without closing its step (plan #1802).
 *
 * A session that ends its run with the step neither closed nor blocked writes
 * one line saying why, onto the run it was sent as (`plan.ts stopped`). A
 * session that found the work too big for one sitting can add the pieces it
 * would split it into. #1803 reads the line to raise a feature whose last two
 * runs closed nothing, and #1804 writes the pieces as steps on a Yes.
 *
 * The run is found from the step, because a session does not know its run
 * (`run-end.ts`): the newest run fired at the step itself or at a row above
 * it, since a feature batch is fired at the feature.
 *
 * The limits match `plan_runs_stop_reason_ck` and `plan_runs_stop_pieces_ck`
 * (0194), so a refusal here names the problem before the database does.
 */

export const STOP_REASON_MAX = 300;
export const STOP_PIECES_MIN = 2;
export const STOP_PIECES_MAX = 20;
export const STOP_PIECE_MAX = 200;

/** A run as the stop command chooses between them. */
export type StopRunCandidate = {
  id: string;
  planItemId: string;
  status: string;
  createdAt: string;
  /** The run's job; missing on rows read without it. */
  job?: string | null;
};

/** One line: inner whitespace and line breaks folded to single spaces. */
export function stopLine(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/** Why a reason or a list of pieces cannot be stored, or null when they can. */
export function stopRefusal(reason: string, pieces: readonly string[]): string | null {
  if (!reason) return 'Say why the session stopped, in one line: --reason "…".';
  if (reason.length > STOP_REASON_MAX) {
    return `The reason is ${reason.length} characters; keep it under ${STOP_REASON_MAX}.`;
  }
  if (pieces.length === 0) return null;
  if (pieces.length < STOP_PIECES_MIN) {
    return 'One piece is not a split. Name two or more with --piece, or leave them out.';
  }
  if (pieces.length > STOP_PIECES_MAX) {
    return `${pieces.length} pieces is more than ${STOP_PIECES_MAX}. Group them into fewer.`;
  }
  const empty = pieces.findIndex((piece) => !piece);
  if (empty > -1) return `Piece ${empty + 1} is empty.`;
  const long = pieces.findIndex((piece) => piece.length > STOP_PIECE_MAX);
  if (long > -1) {
    return `Piece ${long + 1} is ${pieces[long].length} characters; keep each under ${STOP_PIECE_MAX}.`;
  }
  return null;
}

/**
 * The run a stop reason belongs to: the newest one fired at the step or at a
 * row above it. `chain` is the step's id followed by its ancestors'.
 *
 * Null when no run was fired at the step or above it, which is a session
 * working by hand. The caller refuses a run that reads `finished`: its step
 * closed or blocked after it was fired, so there is no stop to explain.
 */
export function runForStop(
  runs: readonly StopRunCandidate[],
  chain: readonly string[],
): StopRunCandidate | null {
  const ids = new Set(chain);
  let newest: StopRunCandidate | null = null;
  for (const run of runs) {
    if (!ids.has(run.planItemId)) continue;
    if (!newest || new Date(run.createdAt).getTime() > new Date(newest.createdAt).getTime()) {
      newest = run;
    }
  }
  return newest;
}

/** What the stop writes onto the run row. */
export type StopColumns = {
  stop_reason: string;
  stop_pieces: string[] | null;
  stopped_at: string;
  /** Present only when the run was still going: the stop ends it. */
  status?: 'finished' | 'failed';
  /** The reason, on a run the stop ends as failed; null on one it finishes. */
  error?: string | null;
};

/** The statuses of a run whose session has not been written off. */
const GOING = new Set(['started', 'stale', 'awaiting_input']);

/** Whether a run with this status is still counted as going. */
export function stillGoing(status: string): boolean {
  return GOING.has(status);
}

/**
 * How a run whose session wrote a stop line ends.
 *
 * A diagnosis (`unstick`) writes its line as the last thing it does whether
 * or not it found a wall (`reference/unsticking.md`), so its line is the
 * finish and not a failure. Every other job writes one only when its step was
 * neither closed nor blocked, which is a run that did not get there.
 */
export function stoppedEnd(
  run: { job?: string | null },
  reason: string,
): { status: 'finished'; error: null } | { status: 'failed'; error: string } {
  return run.job === 'unstick' ? { status: 'finished', error: null } : { status: 'failed', error: reason };
}

/**
 * The columns to write. A run still going is ended, as `stoppedEnd` says,
 * since the session has said it is over and the plan page and the overnight
 * runner should stop counting it. A run the cutoff already ended keeps the
 * app's note in `error`; the reason goes beside it.
 */
export function stopColumns(
  run: Pick<StopRunCandidate, 'status'> & { job?: string | null },
  reason: string,
  pieces: readonly string[],
  at: string,
): StopColumns {
  const columns: StopColumns = {
    stop_reason: reason,
    stop_pieces: pieces.length > 0 ? [...pieces] : null,
    stopped_at: at,
  };
  if (stillGoing(run.status)) Object.assign(columns, stoppedEnd(run, reason));
  return columns;
}
