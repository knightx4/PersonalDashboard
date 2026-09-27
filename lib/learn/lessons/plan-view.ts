/**
 * What a learning goal's plan page shows (plan #1143, LEARN-LESSONS-SPEC "The
 * plan page"): every unit with its pieces, how many pieces are passed, and
 * the piece that is next.
 *
 * Progress is simply the pieces passed out of the pieces written. Nothing
 * locks: every piece can be opened, and the order is a suggestion. Next up is
 * the first piece not passed in that suggested order, units by their ordinal
 * and pieces by theirs, so a piece skipped earlier comes back as next once
 * the ones after it are passed.
 *
 * Pure, so it is tested without a database; the reads are `plan-store.ts`.
 */

/**
 * Where one piece stands. `practice` and `check` are the halves of a piece
 * that is not passed yet (plan #1142): a piece passes only when both do.
 */
export type PieceState = 'passed' | 'practice' | 'check' | 'open';

export type PlanPiece = { id: string; ordinal: number; title: string; state: PieceState };

export type PlanUnit = {
  id: string;
  ordinal: number;
  title: string;
  covers: string | null;
  outcome: string | null;
  /** Empty until the unit's ideas are laid out and split (plan #1140). */
  pieces: PlanPiece[];
};

export type NextPiece = {
  pieceId: string;
  title: string;
  state: PieceState;
  unitId: string;
  unitOrdinal: number;
  unitTitle: string;
};

export type PlanProgress = {
  passed: number;
  /** Pieces written so far. Units not laid out yet add theirs later. */
  total: number;
  units: number;
  /** Units with their pieces written. */
  unitsWritten: number;
  next: NextPiece | null;
};

/** A piece's state from what has been passed of it. */
export function pieceState(standing: { passed: boolean; practicePassed: boolean; checkPassed: boolean }): PieceState {
  if (standing.passed) return 'passed';
  if (standing.practicePassed) return 'practice';
  if (standing.checkPassed) return 'check';
  return 'open';
}

/** The plan's counts and its next piece. */
export function planProgress(units: readonly PlanUnit[]): PlanProgress {
  const ordered = [...units].sort((a, b) => a.ordinal - b.ordinal);
  let passed = 0;
  let total = 0;
  let next: NextPiece | null = null;
  for (const unit of ordered) {
    const pieces = [...unit.pieces].sort((a, b) => a.ordinal - b.ordinal);
    for (const piece of pieces) {
      total += 1;
      if (piece.state === 'passed') passed += 1;
      else if (!next) {
        next = {
          pieceId: piece.id,
          title: piece.title,
          state: piece.state,
          unitId: unit.id,
          unitOrdinal: unit.ordinal,
          unitTitle: unit.title,
        };
      }
    }
  }
  return {
    passed,
    total,
    units: ordered.length,
    unitsWritten: ordered.filter((unit) => unit.pieces.length > 0).length,
    next,
  };
}

/** "3 of 24 pieces passed", or what is still being written. */
export function progressLine(progress: Pick<PlanProgress, 'passed' | 'total' | 'units' | 'unitsWritten'>): string {
  if (progress.total === 0) {
    return progress.units === 0 ? 'No units yet' : 'Pieces not written yet';
  }
  const line = `${progress.passed} of ${progress.total} ${progress.total === 1 ? 'piece' : 'pieces'} passed`;
  const left = progress.units - progress.unitsWritten;
  return left > 0 ? `${line} · ${left} ${left === 1 ? 'unit' : 'units'} still to split` : line;
}

/** The words beside a piece that is not passed yet, or null for one not started. */
export const PIECE_STATE_WORDS: Record<PieceState, string | null> = {
  passed: 'Passed',
  practice: 'Practice passed, check to go',
  check: 'Check passed, practice to go',
  open: null,
};
