import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { KnowledgeState } from '@/lib/learn/graph/model';
import {
  addDays,
  nextInterval,
  pickDue,
  REVIEW_STEPS,
  reviewedState,
  reviewToday,
  toReviewQuestion,
  type DueReview,
  type IdeaForReview,
  type ReviewQuestionRow,
} from './review';

/**
 * The reads and writes behind spaced review (plan #1145). The schedule is two
 * columns on learn.concept_state; the questions are rows in
 * learn.review_questions. Every query names the person, and every write goes
 * through their own session.
 */

type PassedPieceRow = { id: string; subject_id: string; title: string; concept_ids: string[]; passed_at: string };

export const REVIEW_QUESTION_COLUMNS = 'id, concept_id, question, expected, response, correct, marked_why';

/**
 * Put a passed piece's ideas on the schedule, first due the day after. An
 * idea already on it, from an earlier piece, keeps the gap it has earned.
 */
export async function scheduleIdeas(
  learn: LearnSupabaseClient,
  userId: string,
  conceptIds: readonly string[],
  now: Date = new Date(),
): Promise<void> {
  if (conceptIds.length === 0) return;
  const { error } = await learn
    .from('concept_state')
    .update({ review_interval_days: REVIEW_STEPS[0], review_due_on: addDays(reviewToday(now), REVIEW_STEPS[0]) })
    .eq('user_id', userId)
    .in('concept_id', [...conceptIds])
    .is('review_due_on', null);
  if (error) throw new Error(`Scheduling the piece's ideas for review failed: ${error.message}`);
}

async function loadPassedPieces(learn: LearnSupabaseClient, userId: string): Promise<PassedPieceRow[]> {
  const { data, error } = await learn
    .from('plan_pieces')
    .select('id, subject_id, title, concept_ids, passed_at')
    .eq('user_id', userId)
    .not('passed_at', 'is', null);
  if (error) throw new Error(`Reading the passed pieces failed: ${error.message}`);
  return (data ?? []) as PassedPieceRow[];
}

const toPassed = (row: PassedPieceRow) => ({
  id: row.id,
  subjectId: row.subject_id,
  title: row.title,
  conceptIds: row.concept_ids,
  passedAt: row.passed_at,
});

/**
 * The ideas due by today, most overdue first, each with the piece that taught
 * it and any question already asked on it and not answered. `subjectId` keeps
 * one plan's, and `skip` leaves out ideas the page is teaching already.
 */
export async function loadDueReviews(
  learn: LearnSupabaseClient,
  userId: string,
  options: { limit: number; subjectId?: string; skip?: readonly string[] },
  now: Date = new Date(),
): Promise<DueReview[]> {
  const { data: dueRows, error } = await learn
    .from('concept_state')
    .select('concept_id, review_due_on')
    .eq('user_id', userId)
    .lte('review_due_on', reviewToday(now))
    .order('review_due_on')
    .limit(200);
  if (error) throw new Error(`Reading what is due for review failed: ${error.message}`);
  const due = ((dueRows ?? []) as { concept_id: string; review_due_on: string }[]).map((row) => ({
    conceptId: row.concept_id,
    dueOn: row.review_due_on,
  }));
  if (due.length === 0) return [];

  const pieces = (await loadPassedPieces(learn, userId)).map(toPassed);
  const picked = pickDue(due, pieces, {
    limit: options.limit,
    subjectId: options.subjectId,
    skip: options.skip ? new Set(options.skip) : undefined,
  });
  if (picked.length === 0) return [];

  const conceptIds = picked.map((entry) => entry.conceptId);
  const subjectIds = [...new Set(picked.map((entry) => entry.piece.subjectId))];
  const [concepts, subjects, open] = await Promise.all([
    learn.from('concepts').select('id, name').eq('user_id', userId).in('id', conceptIds),
    learn.from('subjects').select('id, name').eq('user_id', userId).in('id', subjectIds),
    learn
      .from('review_questions')
      .select(REVIEW_QUESTION_COLUMNS)
      .eq('user_id', userId)
      .in('concept_id', conceptIds)
      .is('response', null)
      .order('created_at', { ascending: false }),
  ]);
  if (concepts.error) throw new Error(`Reading the ideas due failed: ${concepts.error.message}`);
  if (subjects.error) throw new Error(`Reading the plans failed: ${subjects.error.message}`);
  if (open.error) throw new Error(`Reading the review questions failed: ${open.error.message}`);

  const names = new Map(((concepts.data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]));
  const tracks = new Map(((subjects.data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]));
  const openByConcept = new Map<string, ReviewQuestionRow>();
  for (const row of (open.data ?? []) as ReviewQuestionRow[]) {
    if (!openByConcept.has(row.concept_id)) openByConcept.set(row.concept_id, row);
  }

  return picked.flatMap((entry) => {
    const name = names.get(entry.conceptId);
    if (!name) return [];
    const question = openByConcept.get(entry.conceptId);
    return [
      {
        conceptId: entry.conceptId,
        name,
        subjectId: entry.piece.subjectId,
        trackName: tracks.get(entry.piece.subjectId) ?? '',
        pieceId: entry.piece.id,
        pieceTitle: entry.piece.title,
        dueOn: entry.dueOn,
        open: question ? toReviewQuestion(question) : null,
      },
    ];
  });
}

/** An idea on the schedule, as the writer and marker are given it, with where it stands. */
export type ReviewTarget = {
  idea: IdeaForReview;
  interval: number;
  dueOn: string;
  state: KnowledgeState;
};

/** The idea with its schedule, or null when it is not on the schedule or in no passed piece. */
export async function loadReviewTarget(
  learn: LearnSupabaseClient,
  userId: string,
  conceptId: string,
): Promise<ReviewTarget | null> {
  const [state, concept, pieces] = await Promise.all([
    learn
      .from('concept_state')
      .select('state, review_interval_days, review_due_on')
      .eq('user_id', userId)
      .eq('concept_id', conceptId)
      .maybeSingle(),
    learn.from('concepts').select('name, claim').eq('user_id', userId).eq('id', conceptId).maybeSingle(),
    loadPassedPieces(learn, userId),
  ]);
  if (state.error) throw new Error(`Reading the idea's schedule failed: ${state.error.message}`);
  if (concept.error) throw new Error(`Reading the idea failed: ${concept.error.message}`);
  const row = state.data as { state: KnowledgeState; review_interval_days: number | null; review_due_on: string | null } | null;
  const idea = concept.data as { name: string; claim: string } | null;
  if (!row || row.review_interval_days === null || row.review_due_on === null || !idea) return null;

  const piece = pickDue([{ conceptId, dueOn: row.review_due_on }], pieces.map(toPassed), { limit: 1 })[0]?.piece;
  if (!piece) return null;
  const { data: subject, error } = await learn
    .from('subjects')
    .select('name')
    .eq('user_id', userId)
    .eq('id', piece.subjectId)
    .maybeSingle();
  if (error) throw new Error(`Reading the plan failed: ${error.message}`);

  return {
    idea: {
      trackName: (subject as { name: string } | null)?.name ?? '',
      pieceTitle: piece.title,
      name: idea.name,
      claim: idea.claim,
    },
    interval: row.review_interval_days,
    dueOn: row.review_due_on,
    state: row.state,
  };
}

/** Every review question asked on the idea, newest first, for the writer to avoid. */
export async function loadAskedReviews(
  learn: LearnSupabaseClient,
  userId: string,
  conceptId: string,
): Promise<string[]> {
  const { data, error } = await learn
    .from('review_questions')
    .select('question')
    .eq('user_id', userId)
    .eq('concept_id', conceptId)
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw new Error(`Reading the questions asked failed: ${error.message}`);
  return ((data ?? []) as { question: string }[]).map((row) => row.question);
}

/**
 * Move the idea along the schedule after a marked answer and record what the
 * answer showed. Returns the new gap in days.
 */
export async function recordReview(
  learn: LearnSupabaseClient,
  userId: string,
  conceptId: string,
  target: Pick<ReviewTarget, 'interval' | 'state'>,
  correct: boolean,
  now: Date = new Date(),
): Promise<number> {
  const days = nextInterval(target.interval, correct);
  const { error } = await learn
    .from('concept_state')
    .update({
      review_interval_days: days,
      review_due_on: addDays(reviewToday(now), days),
      state: reviewedState(target.state, correct),
      established: 'tested',
      misconception: null,
      tested_at: now.toISOString(),
      declared_at: null,
    })
    .eq('user_id', userId)
    .eq('concept_id', conceptId);
  if (error) throw new Error(`Recording the review failed: ${error.message}`);
  return days;
}
