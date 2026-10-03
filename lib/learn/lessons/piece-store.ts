import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { KnowledgeState } from '@/lib/learn/graph/model';
import { scheduleIdeas } from './review-store';
import { passedState, toPieceCheck, type PieceCheck, type PieceCheckRow, type PieceForCheck } from './piece-check';

/**
 * The reads and writes behind a piece's page (plan #1141). Shared by the page
 * and its presses (the person's session) and by writing a missing lesson (the
 * service role), so every query names the person.
 */

/** A lesson's parts, in the order the page shows them. */
export type LessonView = {
  takeaway: string;
  context: string | null;
  hook: string | null;
  summary: string | null;
  example: string | null;
  question: string | null;
  answer: string | null;
};

/** One idea of the piece, with its lesson once one is written. */
export type PieceIdea = {
  conceptId: string;
  name: string;
  claim: string;
  lesson: LessonView | null;
  /** Why no lesson could be written, when the writer declined it. */
  dropped: string | null;
};

export type PieceSibling = { id: string; ordinal: number; title: string; passed: boolean };

export type PiecePage = {
  piece: { id: string; ordinal: number; title: string; passedAt: string | null };
  subject: { id: string; name: string };
  unit: { id: string; ordinal: number; title: string; outcome: string | null };
  /** Every piece of the unit, this one included, in the suggested order. */
  siblings: PieceSibling[];
  ideas: PieceIdea[];
  /** The latest question asked on the piece, or null before the first. */
  check: PieceCheck | null;
};

type PieceRow = {
  id: string;
  subject_id: string;
  unit_id: string;
  ordinal: number;
  title: string;
  concept_ids: string[];
  passed_at: string | null;
};

type LessonRow = {
  concept_id: string;
  status: string;
  takeaway: string | null;
  context: string | null;
  hook: string | null;
  summary: string | null;
  example: string | null;
  check_question: string | null;
  check_answer: string | null;
  drop_reason: string | null;
};

const PIECE_COLUMNS = 'id, subject_id, unit_id, ordinal, title, concept_ids, passed_at';

/** The piece, when it is the person's and on this track. */
export async function loadPieceRow(
  learn: LearnSupabaseClient,
  userId: string,
  subjectId: string,
  pieceId: string,
): Promise<PieceRow | null> {
  const { data, error } = await learn
    .from('plan_pieces')
    .select(PIECE_COLUMNS)
    .eq('id', pieceId)
    .eq('subject_id', subjectId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`Reading the piece failed: ${error.message}`);
  return (data as PieceRow | null) ?? null;
}

/** The concepts' names and claims, in the order given. Deleted ones drop out. */
async function loadIdeas(
  learn: LearnSupabaseClient,
  userId: string,
  conceptIds: readonly string[],
): Promise<{ id: string; name: string; claim: string }[]> {
  if (conceptIds.length === 0) return [];
  const { data, error } = await learn
    .from('concepts')
    .select('id, name, claim')
    .eq('user_id', userId)
    .in('id', [...conceptIds]);
  if (error) throw new Error(`Reading the piece's ideas failed: ${error.message}`);
  const byId = new Map(((data ?? []) as { id: string; name: string; claim: string }[]).map((row) => [row.id, row]));
  return conceptIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

/**
 * The lesson cards written for these concepts, by concept. A concept has at
 * most one (the feed's unique index), whether the top-up wrote it for Learn
 * now or a piece's page wrote it when the piece was opened.
 */
export async function loadLessons(
  learn: LearnSupabaseClient,
  userId: string,
  conceptIds: readonly string[],
): Promise<Map<string, Pick<PieceIdea, 'lesson' | 'dropped'>>> {
  const found = new Map<string, Pick<PieceIdea, 'lesson' | 'dropped'>>();
  if (conceptIds.length === 0) return found;
  const { data, error } = await learn
    .from('feed_cards')
    .select('concept_id, status, takeaway, context, hook, summary, example, check_question, check_answer, drop_reason')
    .eq('user_id', userId)
    .eq('reason', 'lesson')
    .in('concept_id', [...conceptIds]);
  if (error) throw new Error(`Reading the piece's lessons failed: ${error.message}`);
  for (const row of (data ?? []) as LessonRow[]) {
    if (row.status === 'dropped' || !row.takeaway) {
      found.set(row.concept_id, { lesson: null, dropped: row.drop_reason ?? 'No lesson could be written for it.' });
      continue;
    }
    found.set(row.concept_id, {
      lesson: {
        takeaway: row.takeaway,
        context: row.context,
        hook: row.hook,
        summary: row.summary,
        example: row.example,
        question: row.check_question,
        answer: row.check_answer,
      },
      dropped: null,
    });
  }
  return found;
}

/** One idea with its lesson, for the page after a lesson is written. */
export async function loadPieceIdea(
  learn: LearnSupabaseClient,
  userId: string,
  conceptId: string,
): Promise<PieceIdea | null> {
  const [ideas, lessons] = await Promise.all([
    loadIdeas(learn, userId, [conceptId]),
    loadLessons(learn, userId, [conceptId]),
  ]);
  const idea = ideas[0];
  if (!idea) return null;
  const lesson = lessons.get(conceptId);
  return { conceptId, name: idea.name, claim: idea.claim, lesson: lesson?.lesson ?? null, dropped: lesson?.dropped ?? null };
}

/** The latest question asked on the piece. */
async function loadLatestCheck(
  learn: LearnSupabaseClient,
  userId: string,
  pieceId: string,
): Promise<PieceCheckRow | null> {
  const { data, error } = await learn
    .from('piece_checks')
    .select('id, question, expected, response, correct, marked_why')
    .eq('user_id', userId)
    .eq('piece_id', pieceId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Reading the piece's check failed: ${error.message}`);
  return (data as PieceCheckRow | null) ?? null;
}

/** Everything the page shows, or null when the piece is not on this track. */
export async function loadPiecePage(
  learn: LearnSupabaseClient,
  userId: string,
  subjectId: string,
  pieceId: string,
): Promise<PiecePage | null> {
  const piece = await loadPieceRow(learn, userId, subjectId, pieceId);
  if (!piece) return null;

  const [subject, unit, siblings, ideas, lessons, check] = await Promise.all([
    learn.from('subjects').select('id, name').eq('id', subjectId).eq('user_id', userId).maybeSingle(),
    learn
      .from('curriculum_units')
      .select('id, ordinal, title, outcome')
      .eq('id', piece.unit_id)
      .eq('user_id', userId)
      .maybeSingle(),
    learn
      .from('plan_pieces')
      .select('id, ordinal, title, passed_at')
      .eq('unit_id', piece.unit_id)
      .eq('user_id', userId)
      .order('ordinal'),
    loadIdeas(learn, userId, piece.concept_ids),
    loadLessons(learn, userId, piece.concept_ids),
    loadLatestCheck(learn, userId, piece.id),
  ]);
  if (subject.error) throw new Error(`Reading the subject failed: ${subject.error.message}`);
  if (unit.error) throw new Error(`Reading the unit failed: ${unit.error.message}`);
  if (siblings.error) throw new Error(`Reading the unit's pieces failed: ${siblings.error.message}`);
  if (!subject.data || !unit.data) return null;

  return {
    piece: { id: piece.id, ordinal: piece.ordinal, title: piece.title, passedAt: piece.passed_at },
    subject: subject.data as { id: string; name: string },
    unit: unit.data as PiecePage['unit'],
    siblings: ((siblings.data ?? []) as { id: string; ordinal: number; title: string; passed_at: string | null }[]).map(
      (row) => ({ id: row.id, ordinal: row.ordinal, title: row.title, passed: row.passed_at !== null }),
    ),
    ideas: ideas.map((idea) => {
      const lesson = lessons.get(idea.id);
      return {
        conceptId: idea.id,
        name: idea.name,
        claim: idea.claim,
        lesson: lesson?.lesson ?? null,
        dropped: lesson?.dropped ?? null,
      };
    }),
    check: check ? toPieceCheck(check) : null,
  };
}

/** The piece as the check's writer and marker are given it, with its ideas' ids. */
export async function loadPieceForCheck(
  learn: LearnSupabaseClient,
  userId: string,
  subjectId: string,
  pieceId: string,
): Promise<{ piece: PieceForCheck; conceptIds: string[]; passedAt: string | null } | null> {
  const row = await loadPieceRow(learn, userId, subjectId, pieceId);
  if (!row) return null;
  const [subject, unit, ideas] = await Promise.all([
    learn.from('subjects').select('name').eq('id', subjectId).eq('user_id', userId).maybeSingle(),
    learn.from('curriculum_units').select('title, outcome').eq('id', row.unit_id).eq('user_id', userId).maybeSingle(),
    loadIdeas(learn, userId, row.concept_ids),
  ]);
  if (subject.error) throw new Error(`Reading the subject failed: ${subject.error.message}`);
  if (unit.error) throw new Error(`Reading the unit failed: ${unit.error.message}`);
  if (!subject.data || !unit.data || ideas.length === 0) return null;
  const unitRow = unit.data as { title: string; outcome: string | null };
  return {
    piece: {
      trackName: (subject.data as { name: string }).name,
      unitTitle: unitRow.title,
      unitOutcome: unitRow.outcome,
      pieceTitle: row.title,
      ideas: ideas.map((idea) => ({ name: idea.name, claim: idea.claim })),
    },
    conceptIds: ideas.map((idea) => idea.id),
    passedAt: row.passed_at,
  };
}

/** Every question asked on the piece so far, newest first, for the writer to avoid. */
export async function loadAskedQuestions(
  learn: LearnSupabaseClient,
  userId: string,
  pieceId: string,
): Promise<string[]> {
  const { data, error } = await learn
    .from('piece_checks')
    .select('question')
    .eq('user_id', userId)
    .eq('piece_id', pieceId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Reading the questions asked failed: ${error.message}`);
  return ((data ?? []) as { question: string }[]).map((row) => row.question);
}

/**
 * Mark the piece's ideas tested after its check is passed, whatever state
 * they were in: sharp stays sharp and everything else becomes known
 * (`passedState`). What changes with it is that the state now rests on an
 * answer, so the date you declared it goes and any misconception named on it
 * is cleared. Returns how many were marked.
 */
export async function markPieceIdeasTested(
  learn: LearnSupabaseClient,
  userId: string,
  conceptIds: readonly string[],
): Promise<number> {
  if (conceptIds.length === 0) return 0;
  const { data, error } = await learn
    .from('concept_state')
    .select('concept_id, state')
    .eq('user_id', userId)
    .in('concept_id', [...conceptIds]);
  if (error) throw new Error(`Reading the piece's ideas failed: ${error.message}`);
  const current = new Map(
    ((data ?? []) as { concept_id: string; state: KnowledgeState }[]).map((row) => [row.concept_id, row.state]),
  );
  const now = new Date().toISOString();
  const { error: writeError } = await learn.from('concept_state').upsert(
    conceptIds.map((conceptId) => ({
      concept_id: conceptId,
      user_id: userId,
      state: passedState(current.get(conceptId) ?? null),
      established: 'tested',
      misconception: null,
      tested_at: now,
      declared_at: null,
    })),
    { onConflict: 'concept_id' },
  );
  if (writeError) throw new Error(`Marking the piece's ideas tested failed: ${writeError.message}`);
  return conceptIds.length;
}

/**
 * Set the piece passed, keeping the first date it was passed on, and put its
 * ideas on the review schedule (plan #1145) when this press is the one that
 * passed it.
 */
export async function markPiecePassed(learn: LearnSupabaseClient, userId: string, pieceId: string): Promise<string> {
  const now = new Date().toISOString();
  const { data, error } = await learn
    .from('plan_pieces')
    .update({ passed_at: now })
    .eq('id', pieceId)
    .eq('user_id', userId)
    .is('passed_at', null)
    .select('concept_ids');
  if (error) throw new Error(`Marking the piece passed failed: ${error.message}`);
  const passed = ((data ?? []) as { concept_ids: string[] }[])[0];
  if (passed) await scheduleIdeas(learn, userId, passed.concept_ids);
  return now;
}

/** A track's pieces grouped by unit, in their suggested order, for the track page. */
export async function loadTrackPieces(
  learn: LearnSupabaseClient,
  userId: string,
  subjectId: string,
): Promise<Map<string, PieceSibling[]>> {
  const { data, error } = await learn
    .from('plan_pieces')
    .select('id, unit_id, ordinal, title, passed_at')
    .eq('user_id', userId)
    .eq('subject_id', subjectId)
    .order('ordinal');
  if (error) throw new Error(`Reading the subject's pieces failed: ${error.message}`);
  const byUnit = new Map<string, PieceSibling[]>();
  for (const row of (data ?? []) as { id: string; unit_id: string; ordinal: number; title: string; passed_at: string | null }[]) {
    const list = byUnit.get(row.unit_id) ?? [];
    list.push({ id: row.id, ordinal: row.ordinal, title: row.title, passed: row.passed_at !== null });
    byUnit.set(row.unit_id, list);
  }
  return byUnit;
}
