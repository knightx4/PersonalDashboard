import type { KnowledgeState } from '@/lib/learn/graph/model';

/**
 * Spaced review of the ideas you have shown or said you know (plan #1145,
 * LEARN-LESSONS-SPEC "Passed pieces come back as review questions"). Pure, so
 * the schedule, the prompt and the rules are tested without a model or a
 * database.
 *
 * An idea goes on the schedule the first time it is tested or declared in a
 * state worth reviewing: first due the next day when an answer put it there,
 * three days on when it rests on your word. A right answer moves the idea one step along the ladder, and past its
 * end the gap doubles up to a ceiling; a miss puts it back on the first step.
 * Days are UTC dates, stored in `concept_state.review_due_on`.
 */

/** The gaps in days a right answer climbs through, first to last. */
export const REVIEW_STEPS = [1, 3, 7, 16, 35] as const;

/**
 * The states that put an idea on the schedule. Unknown has nothing to recall
 * and a misconception is fixed by teaching, not asked about as if it were
 * known; both join once a later answer moves them into one of these.
 */
export const REVIEWABLE_STATES = ['shaky', 'recognised', 'known', 'sharp'] as const satisfies readonly KnowledgeState[];

/** How the state came to be, as it decides the first gap. */
export type ScheduleBasis = 'tested' | 'declared';

/**
 * The first gap for an idea newly on the schedule. A tested idea comes back
 * the next day; a declared one is given the second step, since nothing was
 * learned on the day to forget, and its first question is the first check on
 * the claim.
 */
export function firstReviewDays(basis: ScheduleBasis): number {
  return basis === 'declared' ? REVIEW_STEPS[1] : REVIEW_STEPS[0];
}

/** Whether a state puts an idea on the schedule. */
export function isReviewable(state: KnowledgeState | null | undefined): boolean {
  return (REVIEWABLE_STATES as readonly string[]).includes(state ?? '');
}

/** The longest gap, once doubling past the last step reaches it. */
export const REVIEW_MAX_DAYS = 180;

/** Questions shown in Learn now at once, most overdue first. */
export const REVIEWS_IN_LEARN_NOW = 5;

/** Questions opening a piece's page, from the same plan. */
export const REVIEWS_AT_PIECE_START = 2;

/** The gap after an answer, given the gap the idea was on. */
export function nextInterval(current: number | null, correct: boolean): number {
  if (!correct || current === null || current < 1) return REVIEW_STEPS[0];
  const next = REVIEW_STEPS.find((step) => step > current);
  return next ?? Math.min(current * 2, REVIEW_MAX_DAYS);
}

/**
 * The gap after a right answer given at Guessing (plan #2522.3): the gap the
 * idea was already on, so it is neither pushed out nor pulled back. A guess
 * that lands shows nothing either way.
 */
export function heldInterval(current: number | null): number {
  return current === null || current < 1 ? REVIEW_STEPS[0] : current;
}

/** Today as a UTC date, `YYYY-MM-DD`. */
export function reviewToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** The UTC date `days` after `today`. */
export function addDays(today: string, days: number): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** When the next question comes, as the card says it after an answer. */
export function nextDueLine(days: number): string {
  if (days === 1) return 'It comes back tomorrow.';
  return `It comes back in ${days} days.`;
}

/**
 * The state an idea is left in by a review answer. A right one keeps sharp
 * sharp and makes anything else known, as a piece's check does; a miss makes
 * it shaky.
 */
export function reviewedState(current: KnowledgeState | null, correct: boolean): KnowledgeState {
  if (!correct) return 'shaky';
  return current === 'sharp' ? 'sharp' : 'known';
}

/** The idea as the question's writer and marker are given it. */
export type IdeaForReview = {
  trackName: string;
  /** The first passed piece that taught it, or null when no piece did. */
  pieceTitle: string | null;
  name: string;
  claim: string;
};

/** Earlier questions named to the writer, at most, newest first. */
export const EARLIER_REVIEWS_NAMED = 5;

/** The lines about the idea that both the writer and the marker are given. */
export function reviewLines(idea: IdeaForReview): string[] {
  const piece = idea.pieceTitle?.trim();
  return [
    `Track: ${idea.trackName.trim()}`,
    ...(piece ? [`Piece it was learned in: ${piece}`] : []),
    '',
    `The idea: ${idea.name.trim()}`,
    `What it says: ${idea.claim.trim()}`,
  ];
}

/** The writer's message: the idea, and the questions it must not repeat. */
export function reviewPrompt(idea: IdeaForReview, asked: readonly string[], tool: string): string {
  const earlier = asked
    .map((question) => question.trim())
    .filter(Boolean)
    .slice(0, EARLIER_REVIEWS_NAMED);
  return [
    ...reviewLines(idea),
    ...(earlier.length > 0
      ? [
          '',
          'Already asked about this idea. Work out the situation each one was set in, and set yours in a different one:',
          ...earlier.map((question) => `- ${question}`),
        ]
      : []),
    '',
    `Call ${tool}.`,
  ].join('\n');
}

/** One review question, as a card shows it. */
export type ReviewQuestion = {
  id: string;
  question: string;
  /** Shown once it is answered. */
  expected: string | null;
  response: string | null;
  correct: boolean | null;
  why: string | null;
};

/** The row as stored in learn.review_questions. */
export type ReviewQuestionRow = {
  id: string;
  concept_id: string;
  question: string;
  expected: string;
  response: string | null;
  correct: boolean | null;
  marked_why: string | null;
};

/** The row as the page is given it, with the expected answer held back until answered. */
export function toReviewQuestion(row: ReviewQuestionRow): ReviewQuestion {
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

/** One idea due for review, as Learn now and a piece's page list it. */
export type DueReview = {
  conceptId: string;
  name: string;
  /** The track the idea belongs to. */
  subjectId: string;
  trackName: string;
  /** The first passed piece that taught it; null for an idea no piece has taught. */
  pieceId: string | null;
  pieceTitle: string | null;
  dueOn: string;
  /** A question asked and not answered yet, shown again rather than paid for twice. */
  open: ReviewQuestion | null;
};

/** A due idea and the track it belongs to. */
type Candidate = { conceptId: string; dueOn: string; subjectId: string };
type PassedPiece = { id: string; subjectId: string; title: string; conceptIds: readonly string[]; passedAt: string };

/**
 * Which due ideas to show, most overdue first, each with the first passed
 * piece that taught it when one did. An idea goes on the schedule when it is
 * tested or declared anywhere in Learn, so most have no piece, and the piece
 * is only a label. `subjectId` keeps only that track's ideas, and `skip`
 * leaves out ideas the page is teaching already.
 */
export function pickDue(
  due: readonly Candidate[],
  pieces: readonly PassedPiece[],
  options: { limit: number; subjectId?: string; skip?: ReadonlySet<string> },
): { conceptId: string; dueOn: string; subjectId: string; piece: PassedPiece | null }[] {
  const firstPiece = new Map<string, PassedPiece>();
  for (const piece of [...pieces].sort((a, b) => a.passedAt.localeCompare(b.passedAt))) {
    for (const conceptId of piece.conceptIds) if (!firstPiece.has(conceptId)) firstPiece.set(conceptId, piece);
  }
  const ordered = [...due]
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.conceptId.localeCompare(b.conceptId))
    .filter((candidate) => !options.subjectId || candidate.subjectId === options.subjectId)
    .filter((candidate) => !options.skip?.has(candidate.conceptId))
    .map((candidate) => ({ ...candidate, piece: firstPiece.get(candidate.conceptId) ?? null }));
  return spreadPieces(ordered).slice(0, options.limit);
}

/**
 * Reorder a due list, already in due order, so two ideas from one piece never
 * sit side by side while another piece has one due (plan #2522.8). Each place
 * takes the earliest idea left whose piece differs from the one before; only
 * when every idea left is from that piece does it follow itself. Ideas no
 * piece taught have no piece to repeat.
 */
export function spreadPieces<T extends { piece: { id: string } | null }>(ordered: readonly T[]): T[] {
  const left = [...ordered];
  const out: T[] = [];
  while (left.length > 0) {
    const last = out.length > 0 ? out[out.length - 1].piece?.id : undefined;
    const at = left.findIndex((entry) => !entry.piece || entry.piece.id !== last);
    out.push(...left.splice(at === -1 ? 0 : at, 1));
  }
  return out;
}
