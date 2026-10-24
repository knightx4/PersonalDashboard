import 'server-only';

import { archivedSubjectIds } from '@/lib/learn/archived-subjects';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { KnowledgeState } from '@/lib/learn/graph/model';
import {
  addDays,
  firstReviewDays,
  heldInterval,
  nextInterval,
  pickDue,
  REVIEWABLE_STATES,
  reviewedState,
  reviewToday,
  toReviewQuestion,
  type DueReview,
  type IdeaForReview,
  type ReviewQuestionRow,
  type ScheduleBasis,
} from './review';

/**
 * The reads and writes behind spaced review (plan #1145). The schedule is two
 * columns on learn.concept_state; the questions are rows in
 * learn.review_questions. Every query names the person, and every write goes
 * through their own session.
 */

type PassedPieceRow = { id: string; subject_id: string; title: string; concept_ids: string[]; passed_at: string };

export const REVIEW_QUESTION_COLUMNS =
  'id, concept_id, question, expected, response, correct, marked_why, confidence, reasoning, hints_used, first_try';

/**
 * Put ideas on the review schedule the first time they are tested or
 * declared. Every writer of concept_state that rests a state on an answer or
 * on your word calls this after its write, so this is the one place the rule
 * lives. Only ideas in a reviewable state are scheduled (`REVIEWABLE_STATES`),
 * and an idea already on the schedule keeps the gap it has earned. A tested
 * idea is first due the next day and a declared one three days on
 * (`firstReviewDays`).
 */
export async function scheduleIdeas(
  learn: LearnSupabaseClient,
  userId: string,
  conceptIds: readonly string[],
  options: { basis?: ScheduleBasis; now?: Date } = {},
): Promise<void> {
  if (conceptIds.length === 0) return;
  const days = firstReviewDays(options.basis ?? 'tested');
  const { error } = await learn
    .from('concept_state')
    .update({ review_interval_days: days, review_due_on: addDays(reviewToday(options.now), days) })
    .eq('user_id', userId)
    .in('concept_id', [...conceptIds])
    .in('state', [...REVIEWABLE_STATES])
    .is('review_due_on', null);
  if (error) throw new Error(`Scheduling the ideas for review failed: ${error.message}`);
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

/** The ideas' names and tracks, read in chunks so a long list stays inside a request URL. */
async function loadConceptLabels(
  learn: LearnSupabaseClient,
  userId: string,
  conceptIds: readonly string[],
): Promise<Map<string, { name: string; subjectId: string }>> {
  const labels = new Map<string, { name: string; subjectId: string }>();
  for (let start = 0; start < conceptIds.length; start += 100) {
    const { data, error } = await learn
      .from('concepts')
      .select('id, name, subject_id')
      .eq('user_id', userId)
      .in('id', conceptIds.slice(start, start + 100));
    if (error) throw new Error(`Reading the ideas due failed: ${error.message}`);
    for (const row of (data ?? []) as { id: string; name: string; subject_id: string }[]) {
      labels.set(row.id, { name: row.name, subjectId: row.subject_id });
    }
  }
  return labels;
}

/**
 * The ideas due by today, most overdue first, each with its track, the first
 * passed piece that taught it when one did, and any question already asked
 * on it and not answered. `subjectId` keeps one track's, and `skip` leaves
 * out ideas the page is teaching already.
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
  const dueList = (dueRows ?? []) as { concept_id: string; review_due_on: string }[];
  if (dueList.length === 0) return [];

  const [labels, passed, archived] = await Promise.all([
    loadConceptLabels(
      learn,
      userId,
      dueList.map((row) => row.concept_id),
    ),
    loadPassedPieces(learn, userId),
    archivedSubjectIds(learn, userId),
  ]);
  // An archived subject's reviews wait until it is restored (plan #2355.3),
  // except on its own page, which names it.
  const due = dueList.flatMap((row) => {
    const label = labels.get(row.concept_id);
    if (!label || (archived.has(label.subjectId) && label.subjectId !== options.subjectId)) return [];
    return [{ conceptId: row.concept_id, dueOn: row.review_due_on, subjectId: label.subjectId }];
  });
  const picked = pickDue(due, passed.map(toPassed), {
    limit: options.limit,
    subjectId: options.subjectId,
    skip: options.skip ? new Set(options.skip) : undefined,
  });
  if (picked.length === 0) return [];

  const conceptIds = picked.map((entry) => entry.conceptId);
  const subjectIds = [...new Set(picked.map((entry) => entry.subjectId))];
  const [subjects, open] = await Promise.all([
    learn.from('subjects').select('id, name').eq('user_id', userId).in('id', subjectIds),
    learn
      .from('review_questions')
      .select(REVIEW_QUESTION_COLUMNS)
      .eq('user_id', userId)
      .in('concept_id', conceptIds)
      .is('response', null)
      .order('created_at', { ascending: false }),
  ]);
  if (subjects.error) throw new Error(`Reading the tracks failed: ${subjects.error.message}`);
  if (open.error) throw new Error(`Reading the review questions failed: ${open.error.message}`);

  const tracks = new Map(((subjects.data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]));
  const openByConcept = new Map<string, ReviewQuestionRow>();
  for (const row of (open.data ?? []) as ReviewQuestionRow[]) {
    if (!openByConcept.has(row.concept_id)) openByConcept.set(row.concept_id, row);
  }

  return picked.flatMap((entry) => {
    const name = labels.get(entry.conceptId)?.name;
    if (!name) return [];
    const question = openByConcept.get(entry.conceptId);
    return [
      {
        conceptId: entry.conceptId,
        name,
        subjectId: entry.subjectId,
        trackName: tracks.get(entry.subjectId) ?? '',
        pieceId: entry.piece?.id ?? null,
        pieceTitle: entry.piece?.title ?? null,
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

/** The idea with its schedule, or null when it is not on the schedule. */
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
    learn.from('concepts').select('name, claim, subject_id').eq('user_id', userId).eq('id', conceptId).maybeSingle(),
    loadPassedPieces(learn, userId),
  ]);
  if (state.error) throw new Error(`Reading the idea's schedule failed: ${state.error.message}`);
  if (concept.error) throw new Error(`Reading the idea failed: ${concept.error.message}`);
  const row = state.data as { state: KnowledgeState; review_interval_days: number | null; review_due_on: string | null } | null;
  const idea = concept.data as { name: string; claim: string; subject_id: string } | null;
  if (!row || row.review_interval_days === null || row.review_due_on === null || !idea) return null;

  const piece = pickDue(
    [{ conceptId, dueOn: row.review_due_on, subjectId: idea.subject_id }],
    pieces.map(toPassed),
    { limit: 1 },
  )[0]?.piece;
  const { data: subject, error } = await learn
    .from('subjects')
    .select('name')
    .eq('user_id', userId)
    .eq('id', idea.subject_id)
    .maybeSingle();
  if (error) throw new Error(`Reading the track failed: ${error.message}`);

  return {
    idea: {
      trackName: (subject as { name: string } | null)?.name ?? '',
      pieceTitle: piece?.title ?? null,
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
  /** Right, but given at Guessing (plan #2522.3) or after a hint (plan #2522.7): the idea stays where it was. */
  guessed = false,
): Promise<number> {
  if (correct && guessed) {
    // Only the next date moves, on the gap it was already on: the state, its
    // basis and its tested date stay as they were.
    const held = heldInterval(target.interval);
    const { error } = await learn
      .from('concept_state')
      .update({ review_interval_days: held, review_due_on: addDays(reviewToday(now), held) })
      .eq('user_id', userId)
      .eq('concept_id', conceptId);
    if (error) throw new Error(`Recording the review failed: ${error.message}`);
    return held;
  }
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
