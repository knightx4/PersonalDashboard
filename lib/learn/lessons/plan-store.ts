import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { loadCurriculum } from '@/lib/learn/graph/curriculum-store';
import { nextUnitToOpen } from './lay-out-unit';
import type { PlanLayoutDue } from './plan-layout';
import { pieceState, planFinished, planProgress, type PlanProgress, type PlanUnit } from './plan-view';
import { loadProjectsPassed } from './project-store';

/**
 * The reads behind a learning goal's plan (plan #1143): one plan for its page,
 * every plan's progress for Learn now and the Goals page, and the goal tracks
 * with a unit still to lay out, for the top-up's plan pass. The pages call
 * these with the person's session and the top-up with the service role, so
 * every query names the person.
 */

type PieceRow = { id: string; unit_id: string; subject_id: string; ordinal: number; title: string; passed_at: string | null };

type AimRow = { id: string; name: string; subject_id: string };

/** Active open goals with a track, oldest first. The Level 3 goal has no plan. */
async function goalsWithTracks(learn: LearnSupabaseClient, userId: string): Promise<AimRow[]> {
  const { data, error } = await learn
    .from('aims')
    .select('id, name, subject_id')
    .eq('user_id', userId)
    .is('archived_at', null)
    .is('list_source', null)
    .not('subject_id', 'is', null)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Reading your goals failed: ${error.message}`);
  return (data ?? []) as AimRow[];
}

/** The goal whose plan this track is, or null for a track that is no goal's. */
export async function planGoalFor(
  learn: LearnSupabaseClient,
  userId: string,
  subjectId: string,
): Promise<{ aimId: string; name: string } | null> {
  const aim = (await goalsWithTracks(learn, userId)).find((row) => row.subject_id === subjectId);
  return aim ? { aimId: aim.id, name: aim.name } : null;
}

async function loadPieces(learn: LearnSupabaseClient, userId: string, subjectIds: readonly string[]): Promise<PieceRow[]> {
  if (subjectIds.length === 0) return [];
  const { data, error } = await learn
    .from('plan_pieces')
    .select('id, unit_id, subject_id, ordinal, title, passed_at')
    .eq('user_id', userId)
    .in('subject_id', [...subjectIds])
    .order('ordinal');
  if (error) throw new Error(`Reading the plan's pieces failed: ${error.message}`);
  return (data ?? []) as PieceRow[];
}

/**
 * Of these pieces, the ones whose practice is passed and the ones with a
 * check question answered right (plan #1142). Only asked for pieces not
 * passed, so a plan with most of its pieces passed reads little.
 */
async function loadHalves(
  learn: LearnSupabaseClient,
  userId: string,
  pieceIds: readonly string[],
): Promise<{ practice: Set<string>; check: Set<string> }> {
  const halves = { practice: new Set<string>(), check: new Set<string>() };
  if (pieceIds.length === 0) return halves;
  const [checks, practice] = await Promise.all([
    learn.from('piece_checks').select('piece_id').eq('user_id', userId).eq('correct', true).in('piece_id', [...pieceIds]),
    learn.from('piece_practice').select('id, piece_id').eq('user_id', userId).in('piece_id', [...pieceIds]),
  ]);
  if (checks.error) throw new Error(`Reading the pieces' checks failed: ${checks.error.message}`);
  if (practice.error) throw new Error(`Reading the pieces' practice failed: ${practice.error.message}`);
  for (const row of (checks.data ?? []) as { piece_id: string }[]) halves.check.add(row.piece_id);

  const pieceOf = new Map(((practice.data ?? []) as { id: string; piece_id: string }[]).map((row) => [row.id, row.piece_id]));
  if (pieceOf.size === 0) return halves;
  const { data, error } = await learn
    .from('piece_practice_handins')
    .select('practice_id')
    .eq('user_id', userId)
    .eq('passed', true)
    .in('practice_id', [...pieceOf.keys()]);
  if (error) throw new Error(`Reading what was handed in failed: ${error.message}`);
  for (const row of (data ?? []) as { practice_id: string }[]) {
    const pieceId = pieceOf.get(row.practice_id);
    if (pieceId) halves.practice.add(pieceId);
  }
  return halves;
}

/** A track's units with their pieces and where each piece stands, for its plan page. */
export async function loadPlan(learn: LearnSupabaseClient, userId: string, subjectId: string): Promise<PlanUnit[]> {
  const [units, pieces] = await Promise.all([
    loadCurriculum(learn, subjectId, userId),
    loadPieces(learn, userId, [subjectId]),
  ]);
  const halves = await loadHalves(
    learn,
    userId,
    pieces.filter((piece) => piece.passed_at === null).map((piece) => piece.id),
  );
  return units.map((unit) => ({
    id: unit.id,
    ordinal: unit.ordinal,
    title: unit.title,
    covers: unit.covers ?? null,
    outcome: unit.outcome ?? null,
    pieces: pieces
      .filter((piece) => piece.unit_id === unit.id)
      .map((piece) => ({
        id: piece.id,
        ordinal: piece.ordinal,
        title: piece.title,
        state: pieceState({
          passed: piece.passed_at !== null,
          practicePassed: halves.practice.has(piece.id),
          checkPassed: halves.check.has(piece.id),
        }),
      })),
  }));
}

/**
 * One goal's plan as Learn now and the Goals page list it. `finished` is its
 * final project passed with every piece passed (plan #1146).
 */
export type PlanSummary = {
  aimId: string;
  name: string;
  subjectId: string;
  progress: PlanProgress;
  projectPassed: boolean;
  finished: boolean;
};

/**
 * Every active goal's plan with its progress, oldest goal first. Next up is
 * read from passed pieces only: a half-done piece is still the next one, and
 * which half is done is shown on the plan page.
 */
export async function loadPlans(learn: LearnSupabaseClient, userId: string): Promise<PlanSummary[]> {
  const aims = await goalsWithTracks(learn, userId);
  if (aims.length === 0) return [];
  const subjectIds = [...new Set(aims.map((aim) => aim.subject_id))];
  const [units, pieces, projectsPassed] = await Promise.all([
    learn
      .from('curriculum_units')
      .select('id, subject_id, ordinal, title')
      .eq('user_id', userId)
      .in('subject_id', subjectIds)
      .order('ordinal'),
    loadPieces(learn, userId, subjectIds),
    loadProjectsPassed(learn, userId, subjectIds),
  ]);
  if (units.error) throw new Error(`Reading the plans' units failed: ${units.error.message}`);
  const unitRows = (units.data ?? []) as { id: string; subject_id: string; ordinal: number; title: string }[];

  return aims.map((aim) => {
    const progress = planProgress(
      unitRows
        .filter((unit) => unit.subject_id === aim.subject_id)
        .map((unit) => ({
          id: unit.id,
          ordinal: unit.ordinal,
          title: unit.title,
          covers: null,
          outcome: null,
          pieces: pieces
            .filter((piece) => piece.unit_id === unit.id)
            .map((piece) => ({
              id: piece.id,
              ordinal: piece.ordinal,
              title: piece.title,
              state: piece.passed_at === null ? ('open' as const) : ('passed' as const),
            })),
        })),
    );
    const projectPassed = projectsPassed.has(aim.subject_id);
    return {
      aimId: aim.id,
      name: aim.name,
      subjectId: aim.subject_id,
      progress,
      projectPassed,
      finished: planFinished(progress, projectPassed),
    };
  });
}

/**
 * Goal tracks with a unit that has no ideas laid out yet, oldest goal first,
 * leaving out tracks held after a failed layout. For the top-up's plan pass
 * (`plan-layout.ts`); it names the person on every read.
 */
export async function loadPlanLayoutsDue(
  learn: LearnSupabaseClient,
  userId: string,
  limit: number,
  now: Date = new Date(),
): Promise<PlanLayoutDue[]> {
  const aims = await goalsWithTracks(learn, userId);
  const subjectIds = [...new Set(aims.map((aim) => aim.subject_id))];
  if (subjectIds.length === 0 || limit <= 0) return [];

  const [subjects, units, goals] = await Promise.all([
    learn
      .from('subjects')
      .select('id, name, lessons_held_until')
      .eq('user_id', userId)
      .in('id', subjectIds),
    learn.from('curriculum_units').select('id, subject_id, ordinal').eq('user_id', userId).in('subject_id', subjectIds),
    learn
      .from('goals')
      .select('subject_id, unit_id, status')
      .eq('user_id', userId)
      .in('subject_id', subjectIds)
      .not('unit_id', 'is', null),
  ]);
  if (subjects.error) throw new Error(`Reading the goal tracks failed: ${subjects.error.message}`);
  if (units.error) throw new Error(`Reading the goal tracks' units failed: ${units.error.message}`);
  if (goals.error) throw new Error(`Reading the goal tracks' goals failed: ${goals.error.message}`);

  const subjectRows = (subjects.data ?? []) as { id: string; name: string; lessons_held_until: string | null }[];
  const unitRows = (units.data ?? []) as { id: string; subject_id: string; ordinal: number }[];
  const goalRows = (goals.data ?? []) as { subject_id: string; unit_id: string | null; status: string }[];

  const due: PlanLayoutDue[] = [];
  for (const subjectId of subjectIds) {
    if (due.length >= limit) break;
    const subject = subjectRows.find((row) => row.id === subjectId);
    if (!subject) continue;
    if (subject.lessons_held_until && new Date(subject.lessons_held_until) > now) continue;
    const next = nextUnitToOpen(
      unitRows.filter((unit) => unit.subject_id === subjectId),
      goalRows
        .filter((goal) => goal.subject_id === subjectId)
        .map((goal) => ({ unitId: goal.unit_id, status: goal.status })),
    );
    if (next) due.push({ subjectId, subjectName: subject.name });
  }
  return due;
}
