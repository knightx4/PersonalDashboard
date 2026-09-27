import type { KnowledgeState } from '@/lib/learn/graph/model';

/**
 * The check at the end of a piece (plan #1141, LEARN-LESSONS-SPEC "A piece is
 * worked through on its own page"). Pure, so the prompt and the rules are
 * tested without a model or a database.
 *
 * One question needing the piece's ideas together, answered in a sentence or
 * two. A right answer passes the piece and marks its ideas tested; a wrong
 * one says what was missing, and trying again asks a fresh question, so the
 * writer is told every question already asked on the piece.
 */

/** Ideas named to the writer and the marker, at most. A piece has a few. */
export const PIECE_IDEAS_NAMED = 8;

/** Earlier questions named to the writer, at most, newest first. */
export const EARLIER_NAMED = 5;

export type PieceForCheck = {
  trackName: string;
  unitTitle: string;
  unitOutcome: string | null;
  pieceTitle: string;
  ideas: readonly { name: string; claim: string }[];
};

/** The lines about the piece that both the writer and the marker are given. */
export function pieceLines(piece: PieceForCheck): string[] {
  const outcome = piece.unitOutcome?.trim();
  return [
    `Track: ${piece.trackName.trim()}`,
    `Unit: ${piece.unitTitle.trim()}`,
    ...(outcome ? [`The unit's outcome: ${outcome}`] : []),
    `This piece of it: ${piece.pieceTitle.trim()}`,
    '',
    'The ideas the piece teaches:',
    ...piece.ideas.slice(0, PIECE_IDEAS_NAMED).map((idea) => `- ${idea.name}: ${idea.claim}`),
  ];
}

/** The writer's message: the piece, and the questions it must not repeat. */
export function pieceCheckPrompt(piece: PieceForCheck, asked: readonly string[], tool: string): string {
  const earlier = asked.map((question) => question.trim()).filter(Boolean).slice(0, EARLIER_NAMED);
  return [
    ...pieceLines(piece),
    ...(earlier.length > 0
      ? ['', 'Already asked on this piece, so ask something else:', ...earlier.map((question) => `- ${question}`)]
      : []),
    '',
    `Call ${tool}.`,
  ].join('\n');
}

/**
 * The state an idea is left in when the piece's check is passed. Sharp stays
 * sharp; everything else becomes known, since a right answer that needed the
 * idea shows it is known, whatever was believed about it before.
 */
export function passedState(current: KnowledgeState | null): 'known' | 'sharp' {
  return current === 'sharp' ? 'sharp' : 'known';
}

/** One question asked on a piece, as the page shows it. */
export type PieceCheck = {
  id: string;
  question: string;
  /** Shown once it is answered. */
  expected: string | null;
  response: string | null;
  correct: boolean | null;
  /** The marker's sentence on what the answer had or was missing. */
  why: string | null;
};

/** The row as stored in learn.piece_checks. */
export type PieceCheckRow = {
  id: string;
  question: string;
  expected: string;
  response: string | null;
  correct: boolean | null;
  marked_why: string | null;
};

/**
 * The row as the page is given it. The expected answer stays on the server
 * until the question is answered, so it cannot be read from the page first.
 */
export function toPieceCheck(row: PieceCheckRow): PieceCheck {
  const answered = row.correct !== null;
  return {
    id: row.id,
    question: row.question,
    expected: answered ? row.expected : null,
    response: row.response,
    correct: row.correct,
    why: row.marked_why,
  };
}
