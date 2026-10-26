import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { parsePieceTalk } from '@/lib/learn/lessons/piece-talk';
import { planEntries } from '@/lib/learn/lessons/plan-store';
import { loadDueReviews } from '@/lib/learn/lessons/review-store';
import { loadGradeMap } from '@/lib/learn/levels/loader-grade';
import { countAnswered, loadLensScope } from '@/lib/learn/levels/practice-store';
import type { GradeMap } from '@/lib/learn/levels/grade';
import { loadLevelLessonStates } from '@/lib/learn/levels/level-lesson-store';
import { chooseNext, type ChooseNextInput, type NextItem, type SessionPiece, type SessionSubject } from './choose';

/**
 * The reads behind `chooseNext` (plan #2546.2): due reviews, the plans of
 * every subject a goal points at or whose preparation has finished (archived
 * ones left out, as `planEntries` does), how far each piece's lessons, check
 * and task have got, and the topic map with its evidence. Every query names
 * the person, so the service role reads only their rows.
 */

/** Reviews read at a time. The session asks again after each, so a few is plenty. */
const REVIEWS_READ = 20;

/** Ids per `in` filter, so a long plan does not make an over-long request. */
const CHUNK = 100;

type UnitRow = { id: string; subject_id: string; ordinal: number };
type PieceRow = {
  id: string;
  unit_id: string;
  subject_id: string;
  ordinal: number;
  title: string;
  concept_ids: string[] | null;
  passed_at: string | null;
  held_at: string | null;
  talk: unknown;
};
type CheckRow = { id: string; piece_id: string; correct: boolean | null; response: string | null; created_at: string };
type PracticeRow = { id: string; piece_id: string };
type HandinRow = { practice_id: string; passed: boolean | null; created_at: string };
type CardRow = { id: string; concept_id: string; status: string; acted_at: string | null };

/** Lesson card statuses that mean it has not been read: chosen, or written and waiting. */
const UNREAD = new Set(['picked', 'ready']);

function chunks<T>(ids: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let at = 0; at < ids.length; at += CHUNK) out.push(ids.slice(at, at + CHUNK));
  return out;
}

async function inChunks<T>(
  ids: readonly string[],
  read: (ids: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  what: string,
): Promise<T[]> {
  const out: T[] = [];
  for (const part of chunks(ids)) {
    const { data, error } = await read(part);
    if (error) throw new Error(`Reading ${what} failed: ${error.message}`);
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

function later(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/** Every subject with a plan, its pieces in order and where each stands. */
export async function loadSessionSubjects(learn: LearnSupabaseClient, userId: string): Promise<SessionSubject[]> {
  const entries = await planEntries(learn, userId);
  if (entries.length === 0) return [];
  const subjectIds = [...new Set(entries.map((entry) => entry.subjectId))];

  const [units, pieces] = await Promise.all([
    learn.from('curriculum_units').select('id, subject_id, ordinal').eq('user_id', userId).in('subject_id', subjectIds),
    learn
      .from('plan_pieces')
      .select('id, unit_id, subject_id, ordinal, title, concept_ids, passed_at, held_at, talk')
      .eq('user_id', userId)
      .in('subject_id', subjectIds),
  ]);
  if (units.error) throw new Error(`Reading your plans' units failed: ${units.error.message}`);
  if (pieces.error) throw new Error(`Reading your plans' pieces failed: ${pieces.error.message}`);
  const unitRows = (units.data ?? []) as UnitRow[];
  const pieceRows = (pieces.data ?? []) as PieceRow[];
  const pieceIds = pieceRows.map((piece) => piece.id);
  const open = pieceRows.filter((piece) => piece.passed_at === null);
  const conceptIds = [...new Set(open.flatMap((piece) => piece.concept_ids ?? []))];

  const [checks, practice, cards, concepts] = await Promise.all([
    inChunks<CheckRow>(
      pieceIds,
      (ids) => learn.from('piece_checks').select('id, piece_id, correct, response, created_at').eq('user_id', userId).in('piece_id', ids),
      "your pieces' checks",
    ),
    inChunks<PracticeRow>(
      pieceIds,
      (ids) => learn.from('piece_practice').select('id, piece_id').eq('user_id', userId).in('piece_id', ids),
      "your pieces' practice",
    ),
    inChunks<CardRow>(
      conceptIds,
      (ids) =>
        learn
          .from('feed_cards')
          .select('id, concept_id, status, acted_at')
          .eq('user_id', userId)
          .eq('reason', 'lesson')
          .in('concept_id', ids),
      "your pieces' lessons",
    ),
    inChunks<{ id: string; name: string }>(
      conceptIds,
      (ids) => learn.from('concepts').select('id, name').eq('user_id', userId).in('id', ids),
      "your pieces' ideas",
    ),
  ]);
  const handins = await inChunks<HandinRow>(
    practice.map((row) => row.id),
    (ids) => learn.from('piece_practice_handins').select('practice_id, passed, created_at').eq('user_id', userId).in('practice_id', ids),
    'what you handed in',
  );

  const unitOrdinal = new Map(unitRows.map((unit) => [unit.id, unit.ordinal]));
  const subjectOfPiece = new Map(pieceRows.map((piece) => [piece.id, piece.subject_id]));
  const conceptName = new Map(concepts.map((row) => [row.id, row.name]));
  const cardOf = new Map(cards.map((row) => [row.concept_id, row]));
  const lastWorked = new Map<string, string | null>();
  const worked = (subjectId: string | undefined, at: string | null) => {
    if (subjectId && at) lastWorked.set(subjectId, later(lastWorked.get(subjectId) ?? null, at));
  };

  const checksOf = new Map<string, CheckRow[]>();
  for (const row of checks) {
    checksOf.set(row.piece_id, [...(checksOf.get(row.piece_id) ?? []), row]);
    worked(subjectOfPiece.get(row.piece_id), row.created_at);
  }
  const taskOf = new Map(practice.map((row) => [row.piece_id, row.id]));
  const pieceOfTask = new Map(practice.map((row) => [row.id, row.piece_id]));
  const taskPassed = new Set<string>();
  for (const row of handins) {
    const pieceId = pieceOfTask.get(row.practice_id);
    if (!pieceId) continue;
    if (row.passed) taskPassed.add(pieceId);
    worked(subjectOfPiece.get(pieceId), row.created_at);
  }
  for (const piece of open) {
    for (const conceptId of piece.concept_ids ?? []) {
      const card = cardOf.get(conceptId);
      if (card && !UNREAD.has(card.status) && card.status !== 'dropped') worked(piece.subject_id, card.acted_at);
    }
  }

  const toPiece = (piece: PieceRow): SessionPiece => {
    const asked = [...(checksOf.get(piece.id) ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const talk = parsePieceTalk(piece.talk);
    return {
      id: piece.id,
      title: piece.title,
      passed: piece.passed_at !== null,
      held: piece.held_at !== null,
      lessons: (piece.concept_ids ?? []).flatMap((conceptId) => {
        const name = conceptName.get(conceptId);
        const card = cardOf.get(conceptId);
        // A deleted idea has nothing to teach, and a declined lesson nothing to read.
        if (name === undefined || card?.status === 'dropped') return [];
        return [{ conceptId, name, cardId: card?.id ?? null, read: card !== undefined && !UNREAD.has(card.status) }];
      }),
      openCheckId: asked.find((row) => row.response === null)?.id ?? null,
      checkAsked: asked.length > 0 || talk?.stage === 'check' || talk?.stage === 'done',
      checkPassed: asked.some((row) => row.correct === true),
      taskId: taskOf.get(piece.id) ?? null,
      taskPassed: taskPassed.has(piece.id),
    };
  };

  return entries.map((entry) => ({
    id: entry.subjectId,
    name: entry.name,
    aimId: entry.aimId,
    lastWorked: lastWorked.get(entry.subjectId) ?? null,
    pieces: pieceRows
      .filter((piece) => piece.subject_id === entry.subjectId)
      .sort(
        (a, b) =>
          (unitOrdinal.get(a.unit_id) ?? Number.MAX_SAFE_INTEGER) - (unitOrdinal.get(b.unit_id) ?? Number.MAX_SAFE_INTEGER) ||
          a.ordinal - b.ordinal,
      )
      .map(toPiece),
  }));
}

/** The cells a plan piece teaches (plan_pieces.cell_ids), which get no level lesson of their own. */
async function loadTaughtCells(learn: LearnSupabaseClient, userId: string): Promise<Set<string>> {
  const { data, error } = await learn.from('plan_pieces').select('cell_ids').eq('user_id', userId);
  if (error) throw new Error(`Reading which levels your plans teach failed: ${error.message}`);
  return new Set(((data ?? []) as { cell_ids: string[] | null }[]).flatMap((row) => row.cell_ids ?? []));
}

/** Everything `chooseNext` reads, with the map kept whole so a question can be graded from it. */
export type LoadedNextInput = ChooseNextInput & { map: GradeMap };

export async function loadChooseNextInput(
  learn: LearnSupabaseClient,
  userId: string,
  options: { now?: Date; skip?: ReadonlySet<string> } = {},
): Promise<LoadedNextInput> {
  const now = options.now ?? new Date();
  const [reviews, subjects, map, answered, lens, levelLessons, taughtCells] = await Promise.all([
    loadDueReviews(learn, userId, { limit: REVIEWS_READ }, now),
    loadSessionSubjects(learn, userId),
    loadGradeMap(learn, userId),
    countAnswered(learn, userId),
    loadLensScope(learn, userId, null),
    loadLevelLessonStates(learn, userId),
    loadTaughtCells(learn, userId),
  ]);
  return { reviews, subjects, map, answered, lensTargets: lens.targets, skip: options.skip, levelLessons, taughtCells, now };
}

/** The one thing to learn next for this person, or null when nothing is left. */
export async function loadNextItem(
  learn: LearnSupabaseClient,
  userId: string,
  options: { now?: Date; skip?: ReadonlySet<string> } = {},
): Promise<NextItem | null> {
  return chooseNext(await loadChooseNextInput(learn, userId, options));
}
