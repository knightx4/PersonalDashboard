/**
 * Today's piece, the first thing on Now (plan #2164.4): the next piece of
 * your course that a session on Now has not finished, so a visit has one
 * thing to do and visibly completes it.
 *
 * On Now a piece is its lessons and then its check, and a right answer to the
 * check finishes it there. The practice task stays on the piece's own page,
 * and the piece passes only once that is handed in too (plan #1142), so a
 * piece is finished on Now when it is passed or its check is answered right.
 *
 * Which goal: the one you last answered a piece's check in, so a course you
 * are in the middle of keeps you there, and with none yet the oldest goal, as
 * every other list of plans orders them (`loadPlans`). A goal whose pieces are
 * all finished on Now gives way to the next. A goal with no pieces written
 * yet is reported as such when no goal has a piece to give, so Now can point
 * at its outline instead.
 *
 * Pure, so it is tested without a database; the reads are
 * `todays-piece-store.ts`.
 */

export type TodaysPieceGoal = {
  aimId: string;
  name: string;
  subjectId: string;
  /** Units in their suggested order, with their pieces. */
  units: readonly {
    id: string;
    ordinal: number;
    pieces: readonly { id: string; ordinal: number; passed: boolean; checkPassed: boolean }[];
  }[];
  /** When a check on one of this goal's pieces was last asked, or null for never. */
  lastWorked: string | null;
};

export type TodaysPieceChoice =
  | { kind: 'piece'; aimId: string; goalName: string; subjectId: string; pieceId: string }
  | { kind: 'no-pieces'; aimId: string; goalName: string; subjectId: string };

/** The first piece of a goal not finished on Now, in the suggested order. */
export function nextUnfinishedPiece(goal: TodaysPieceGoal): string | null {
  const units = [...goal.units].sort((a, b) => a.ordinal - b.ordinal);
  for (const unit of units) {
    const pieces = [...unit.pieces].sort((a, b) => a.ordinal - b.ordinal);
    const next = pieces.find((piece) => !piece.passed && !piece.checkPassed);
    if (next) return next.id;
  }
  return null;
}

/**
 * The piece Now opens on, or null when there is none to give. `pinned` is a
 * piece named in the link (the morning notification's); it leads when it is
 * one of these goals' and not finished.
 */
export function chooseTodaysPiece(
  goals: readonly TodaysPieceGoal[],
  pinned: string | null = null,
): TodaysPieceChoice | null {
  const pick = (goal: TodaysPieceGoal, pieceId: string): TodaysPieceChoice => ({
    kind: 'piece',
    aimId: goal.aimId,
    goalName: goal.name,
    subjectId: goal.subjectId,
    pieceId,
  });

  if (pinned) {
    for (const goal of goals) {
      const piece = goal.units.flatMap((unit) => unit.pieces).find((row) => row.id === pinned);
      if (piece && !piece.passed && !piece.checkPassed) return pick(goal, piece.id);
    }
  }

  // Most recently worked first; never worked keeps the oldest-first order.
  const ordered = goals
    .map((goal, index) => ({ goal, index }))
    .sort((a, b) => {
      const at = a.goal.lastWorked ?? '';
      const bt = b.goal.lastWorked ?? '';
      if (at !== bt) return at < bt ? 1 : -1;
      return a.index - b.index;
    })
    .map(({ goal }) => goal);

  for (const goal of ordered) {
    const next = nextUnfinishedPiece(goal);
    if (next) return pick(goal, next);
  }
  const unwritten = goals.find((goal) => goal.units.every((unit) => unit.pieces.length === 0));
  return unwritten
    ? { kind: 'no-pieces', aimId: unwritten.aimId, goalName: unwritten.name, subjectId: unwritten.subjectId }
    : null;
}
