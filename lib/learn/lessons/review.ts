import type { KnowledgeState } from '@/lib/learn/graph/model';

/**
 * Spaced review of the ideas in passed pieces (plan #1145, LEARN-LESSONS-SPEC
 * "Passed pieces come back as review questions"). Pure, so the schedule, the
 * prompt and the rules are tested without a model or a database.
 *
 * Passing a piece puts each of its ideas on the schedule, first due the next
 * day. A right answer moves the idea one step along the ladder, and past its
 * end the gap doubles up to a ceiling; a miss puts it back on the first step.
 * Days are UTC dates, stored in `concept_state.review_due_on`.
 */

/** The gaps in days a right answer climbs through, first to last. */
export const REVIEW_STEPS = [1, 3, 7, 16, 35] as const;

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
 * it shaky, since it was known when the piece passed and is not now.
 */
export function reviewedState(current: KnowledgeState | null, correct: boolean): KnowledgeState {
  if (!correct) return 'shaky';
  return current === 'sharp' ? 'sharp' : 'known';
}

/** The idea as the question's writer and marker are given it. */
export type IdeaForReview = {
  trackName: string;
  pieceTitle: string;
  name: string;
  claim: string;
};

/** Earlier questions named to the writer, at most, newest first. */
export const EARLIER_REVIEWS_NAMED = 5;

/** The lines about the idea that both the writer and the marker are given. */
export function reviewLines(idea: IdeaForReview): string[] {
  return [
    `Track: ${idea.trackName.trim()}`,
    `Piece it was learned in: ${idea.pieceTitle.trim()}`,
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
      ? ['', 'Already asked about this idea, so ask something else:', ...earlier.map((question) => `- ${question}`)]
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
  subjectId: string;
  trackName: string;
  pieceId: string;
  pieceTitle: string;
  dueOn: string;
  /** A question asked and not answered yet, shown again rather than paid for twice. */
  open: ReviewQuestion | null;
};

/** A due idea and the passed piece that put it on the schedule. */
type Candidate = { conceptId: string; dueOn: string };
type PassedPiece = { id: string; subjectId: string; title: string; conceptIds: readonly string[]; passedAt: string };

/**
 * Which due ideas to show, most overdue first, each with the first passed
 * piece that taught it. An idea in no passed piece is left out: it is on the
 * schedule from a piece that has since been changed, and there is nothing to
 * say where it came from. `subjectId` keeps only that plan's ideas, and
 * `skip` leaves out ideas the page is teaching already.
 */
export function pickDue(
  due: readonly Candidate[],
  pieces: readonly PassedPiece[],
  options: { limit: number; subjectId?: string; skip?: ReadonlySet<string> },
): { conceptId: string; dueOn: string; piece: PassedPiece }[] {
  const firstPiece = new Map<string, PassedPiece>();
  for (const piece of [...pieces].sort((a, b) => a.passedAt.localeCompare(b.passedAt))) {
    for (const conceptId of piece.conceptIds) if (!firstPiece.has(conceptId)) firstPiece.set(conceptId, piece);
  }
  return [...due]
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.conceptId.localeCompare(b.conceptId))
    .flatMap((candidate) => {
      const piece = firstPiece.get(candidate.conceptId);
      if (!piece) return [];
      if (options.subjectId && piece.subjectId !== options.subjectId) return [];
      if (options.skip?.has(candidate.conceptId)) return [];
      return [{ ...candidate, piece }];
    })
    .slice(0, options.limit);
}
