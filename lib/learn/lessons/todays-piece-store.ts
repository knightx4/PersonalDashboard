import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { rowSubject, type TalkTurn } from '@/lib/talk/talk';
import { loadConversation } from '@/lib/talk/store';
import { parsePieceTalk, type PieceTalkState } from './piece-talk';
import { loadPiecePage, type PiecePage } from './piece-store';
import { goalsWithTracks } from './plan-store';
import { chooseTodaysPiece, type TodaysPieceGoal } from './todays-piece';

/**
 * The reads behind today's piece on Now (plan #2164.4, `todays-piece.ts`):
 * the active goals' units and pieces, which pieces have a check answered
 * right and when each goal's checks were last asked, then the chosen piece
 * as its own page reads it.
 */

/** What Now draws first: a piece to work through, or a goal with none written yet. */
export type TodaysPiece =
  | { kind: 'piece'; goalName: string; page: PiecePage; talk: PieceTalk }
  | { kind: 'no-pieces'; goalName: string; subjectId: string };

/** The piece's conversation with Dash (plan #2164.5): its turns, and where it has got to. */
export type PieceTalk = {
  turns: TalkTurn[];
  state: PieceTalkState | null;
  /** When the page was read: the time on Dash's first turn before it is kept. */
  openedAt: string;
};

/** The thread a piece is worked in, under the piece's own row. */
export function pieceTalkSubject(pieceId: string, title: string) {
  return rowSubject('learn.plan_pieces', pieceId, title);
}

/** Where the piece's thread has got to, from the piece's row. */
export async function loadPieceTalkState(
  learn: LearnSupabaseClient,
  userId: string,
  pieceId: string,
): Promise<PieceTalkState | null> {
  const { data, error } = await learn
    .from('plan_pieces')
    .select('talk')
    .eq('id', pieceId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`Reading the piece's conversation failed: ${error.message}`);
  return parsePieceTalk((data as { talk: unknown } | null)?.talk ?? null);
}

type UnitRow = { id: string; subject_id: string; ordinal: number };
type PieceRow = { id: string; unit_id: string; ordinal: number; passed_at: string | null };
type CheckRow = { piece_id: string; correct: boolean | null; created_at: string };

export async function loadTodaysPiece(
  learn: LearnSupabaseClient,
  userId: string,
  pinned: string | null = null,
  /** Reads the piece's conversation; left out, the thread opens empty. */
  core?: CoreSupabaseClient,
): Promise<TodaysPiece | null> {
  const aims = await goalsWithTracks(learn, userId);
  if (aims.length === 0) return null;
  const subjectIds = [...new Set(aims.map((aim) => aim.subject_id))];

  const [units, pieces] = await Promise.all([
    learn.from('curriculum_units').select('id, subject_id, ordinal').eq('user_id', userId).in('subject_id', subjectIds),
    learn.from('plan_pieces').select('id, unit_id, ordinal, passed_at').eq('user_id', userId).in('subject_id', subjectIds),
  ]);
  if (units.error) throw new Error(`Reading your goals' units failed: ${units.error.message}`);
  if (pieces.error) throw new Error(`Reading your goals' pieces failed: ${pieces.error.message}`);
  const pieceRows = (pieces.data ?? []) as PieceRow[];

  const checks =
    pieceRows.length === 0
      ? { data: [] as CheckRow[], error: null }
      : await learn
          .from('piece_checks')
          .select('piece_id, correct, created_at')
          .eq('user_id', userId)
          .in('piece_id', pieceRows.map((piece) => piece.id));
  if (checks.error) throw new Error(`Reading your pieces' checks failed: ${checks.error.message}`);
  const checkRows = (checks.data ?? []) as CheckRow[];
  const checkPassed = new Set(checkRows.filter((row) => row.correct === true).map((row) => row.piece_id));

  const unitRows = (units.data ?? []) as UnitRow[];
  const subjectOfUnit = new Map(unitRows.map((unit) => [unit.id, unit.subject_id]));
  const subjectOfPiece = new Map(pieceRows.map((piece) => [piece.id, subjectOfUnit.get(piece.unit_id)]));
  const lastWorked = new Map<string, string>();
  for (const row of checkRows) {
    const subjectId = subjectOfPiece.get(row.piece_id);
    if (subjectId && row.created_at > (lastWorked.get(subjectId) ?? '')) lastWorked.set(subjectId, row.created_at);
  }

  const goals: TodaysPieceGoal[] = aims.map((aim) => ({
    aimId: aim.id,
    name: aim.name,
    subjectId: aim.subject_id,
    lastWorked: lastWorked.get(aim.subject_id) ?? null,
    units: unitRows
      .filter((unit) => unit.subject_id === aim.subject_id)
      .map((unit) => ({
        id: unit.id,
        ordinal: unit.ordinal,
        pieces: pieceRows
          .filter((piece) => piece.unit_id === unit.id)
          .map((piece) => ({
            id: piece.id,
            ordinal: piece.ordinal,
            passed: piece.passed_at !== null,
            checkPassed: checkPassed.has(piece.id),
          })),
      })),
  }));

  const choice = chooseTodaysPiece(goals, pinned);
  if (!choice) return null;
  if (choice.kind === 'no-pieces') return choice;
  const page = await loadPiecePage(learn, userId, choice.subjectId, choice.pieceId);
  // A piece whose ideas have all left the subject has nothing to work through.
  if (!page || page.ideas.length === 0) return null;
  const [state, turns] = await Promise.all([
    loadPieceTalkState(learn, userId, page.piece.id),
    core ? loadConversation(core, pieceTalkSubject(page.piece.id, page.piece.title)) : Promise.resolve([]),
  ]);
  return { kind: 'piece', goalName: choice.goalName, page, talk: { turns, state, openedAt: new Date().toISOString() } };
}
