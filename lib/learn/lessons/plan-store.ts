import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { loadCurriculum } from '@/lib/learn/graph/curriculum-store';
import { preparedSubjectIds } from '@/lib/learn/prepare/store';
import { nextUnitToOpen } from './lay-out-unit';
import { unitStarted, type PlanLayoutDue } from './plan-layout';
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
export async function goalsWithTracks(learn: LearnSupabaseClient, userId: string): Promise<AimRow[]> {
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

/** A subject the plan pipeline lays out and writes: a goal's track, or a prepared subject. */
export type PlanSubject = { subjectId: string; aimId: string | null };

/**
 * Every subject the pipeline lays out, splits into pieces and writes lessons
 * for (plan #2292.1): the active goals' tracks, oldest goal first, then each
 * subject whose own preparation has finished and is no goal's track. A
 * prepared subject needs no goal; its first unit is written by the
 * preparation's first_lesson step and its later ones by the top-up from here.
 */
export async function planSubjects(learn: LearnSupabaseClient, userId: string): Promise<PlanSubject[]> {
  const [aims, prepared] = await Promise.all([goalsWithTracks(learn, userId), preparedSubjectIds(learn, userId)]);
  const out: PlanSubject[] = [];
  const seen = new Set<string>();
  for (const aim of aims) {
    if (seen.has(aim.subject_id)) continue;
    seen.add(aim.subject_id);
    out.push({ subjectId: aim.subject_id, aimId: aim.id });
  }
  for (const subjectId of prepared) {
    if (seen.has(subjectId)) continue;
    seen.add(subjectId);
    out.push({ subjectId, aimId: null });
  }
  return out;
}

/** The subject ids `planSubjects` returns, for a caller that only asks whether one is in it. */
export async function planSubjectIds(learn: LearnSupabaseClient, userId: string): Promise<Set<string>> {
  return new Set((await planSubjects(learn, userId)).map((one) => one.subjectId));
}

/** A plan the person works: a goal's, named for the goal, or a prepared subject's, named for the subject. */
export type PlanEntry = { aimId: string | null; name: string; subjectId: string };

/**
 * `planSubjects` with the name each plan goes by (plan #2292.4): the goal's
 * for a track, the subject's own for a prepared subject with no goal. What
 * today's piece and the plan progress read, so a subject needs no goal to
 * be worked from Now.
 */
export async function planEntries(learn: LearnSupabaseClient, userId: string): Promise<PlanEntry[]> {
  const [aims, subjects] = await Promise.all([goalsWithTracks(learn, userId), planSubjects(learn, userId)]);
  const goalName = new Map(aims.map((aim) => [aim.id, aim.name]));
  const bare = subjects.filter((one) => one.aimId === null).map((one) => one.subjectId);
  const subjectName = new Map<string, string>();
  if (bare.length > 0) {
    const { data, error } = await learn.from('subjects').select('id, name').eq('user_id', userId).in('id', bare);
    if (error) throw new Error(`Reading your subjects failed: ${error.message}`);
    for (const row of (data ?? []) as { id: string; name: string }[]) subjectName.set(row.id, row.name);
  }
  return subjects.flatMap((one) => {
    const name = one.aimId ? goalName.get(one.aimId) : subjectName.get(one.subjectId);
    return name === undefined ? [] : [{ aimId: one.aimId, name, subjectId: one.subjectId }];
  });
}

/**
 * The active goals that have a plan, by id: those whose track has been made.
 * What the waiting strip on Now counts goals without a plan against, without
 * reading every plan's units and pieces (plan #1486).
 */
export async function loadPlannedGoals(
  learn: LearnSupabaseClient,
  userId: string,
): Promise<{ aimId: string }[]> {
  const out: { aimId: string }[] = [];
  for (const one of await planSubjects(learn, userId)) if (one.aimId) out.push({ aimId: one.aimId });
  return out;
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

/**
 * Whose plan this track is, for the page and the edits (plan #2307.3): the
 * goal's when a goal points at it, else the subject's own when its
 * preparation has finished. `aimId` is null for the second. Null for a
 * track that is neither, which has no plan.
 */
export async function planOwnerFor(
  learn: LearnSupabaseClient,
  userId: string,
  subjectId: string,
): Promise<{ aimId: string | null; name: string } | null> {
  const goal = await planGoalFor(learn, userId, subjectId);
  if (goal) return goal;
  if (!(await preparedSubjectIds(learn, userId)).has(subjectId)) return null;
  const { data, error } = await learn.from('subjects').select('name').eq('user_id', userId).eq('id', subjectId).maybeSingle();
  if (error) throw new Error(`Reading the subject failed: ${error.message}`);
  const name = (data as { name: string } | null)?.name;
  return name === undefined ? null : { aimId: null, name };
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
  /** Null for a prepared subject that is no goal's track. */
  aimId: string | null;
  name: string;
  subjectId: string;
  progress: PlanProgress;
  projectPassed: boolean;
  finished: boolean;
};

/**
 * Every plan with its progress: the active goals' oldest first, then prepared subjects with no goal (`planEntries`). Next up is
 * read from passed pieces only: a half-done piece is still the next one, and
 * which half is done is shown on the plan page.
 */
export async function loadPlans(learn: LearnSupabaseClient, userId: string): Promise<PlanSummary[]> {
  const entries = await planEntries(learn, userId);
  if (entries.length === 0) return [];
  const subjectIds = [...new Set(entries.map((entry) => entry.subjectId))];
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

  return entries.map((aim) => {
    const progress = planProgress(
      unitRows
        .filter((unit) => unit.subject_id === aim.subjectId)
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
    const projectPassed = projectsPassed.has(aim.subjectId);
    return {
      aimId: aim.aimId,
      name: aim.name,
      subjectId: aim.subjectId,
      progress,
      projectPassed,
      finished: planFinished(progress, projectPassed),
    };
  });
}

/**
 * Whether the person has started each of `unitIds`, read as `unitStarted`
 * reads it: its pieces, the checks asked on them, and the lesson cards for
 * their ideas.
 */
async function loadUnitsStarted(
  learn: LearnSupabaseClient,
  userId: string,
  unitIds: readonly string[],
): Promise<Set<string>> {
  const started = new Set<string>();
  if (unitIds.length === 0) return started;
  const pieces = await learn
    .from('plan_pieces')
    .select('id, unit_id, concept_ids, passed_at')
    .eq('user_id', userId)
    .in('unit_id', [...unitIds]);
  if (pieces.error) throw new Error(`Reading the laid-out pieces failed: ${pieces.error.message}`);
  const pieceRows = (pieces.data ?? []) as { id: string; unit_id: string; concept_ids: string[] | null; passed_at: string | null }[];
  if (pieceRows.length === 0) return started;

  const conceptIds = [...new Set(pieceRows.flatMap((piece) => piece.concept_ids ?? []))];
  const [checks, lessons] = await Promise.all([
    learn
      .from('piece_checks')
      .select('piece_id')
      .eq('user_id', userId)
      .in('piece_id', pieceRows.map((piece) => piece.id)),
    conceptIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : learn
          .from('feed_cards')
          .select('concept_id')
          .eq('user_id', userId)
          .eq('reason', 'lesson')
          .in('concept_id', conceptIds),
  ]);
  if (checks.error) throw new Error(`Reading the pieces' checks failed: ${checks.error.message}`);
  if (lessons.error) throw new Error(`Reading the pieces' lessons failed: ${lessons.error.message}`);
  const checkedPieceIds = new Set(((checks.data ?? []) as { piece_id: string }[]).map((row) => row.piece_id));
  const lessonConceptIds = new Set(((lessons.data ?? []) as { concept_id: string }[]).map((row) => row.concept_id));

  for (const unitId of unitIds) {
    const use = {
      pieces: pieceRows
        .filter((piece) => piece.unit_id === unitId)
        .map((piece) => ({ id: piece.id, conceptIds: piece.concept_ids ?? [], passed: piece.passed_at !== null })),
      checkedPieceIds,
      lessonConceptIds,
    };
    if (unitStarted(use)) started.add(unitId);
  }
  return started;
}

/**
 * Goal tracks and prepared subjects (`planSubjects`) with a unit that has no
 * ideas laid out yet, oldest goal first and prepared subjects after,
 * leaving out tracks held after a failed layout and tracks whose latest
 * laid-out unit the person has not started (`unitStarted`), so a plan is laid
 * out one unit ahead of use. For the top-up's plan pass (`plan-layout.ts`); it
 * names the person on every read.
 */
export async function loadPlanLayoutsDue(
  learn: LearnSupabaseClient,
  userId: string,
  limit: number,
  now: Date = new Date(),
): Promise<PlanLayoutDue[]> {
  const subjectIds = (await planSubjects(learn, userId)).map((one) => one.subjectId);
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
  if (subjects.error) throw new Error(`Reading the goal subjects failed: ${subjects.error.message}`);
  if (units.error) throw new Error(`Reading the goal subjects' units failed: ${units.error.message}`);
  if (goals.error) throw new Error(`Reading the goal subjects' goals failed: ${goals.error.message}`);

  const subjectRows = (subjects.data ?? []) as { id: string; name: string; lessons_held_until: string | null }[];
  const unitRows = (units.data ?? []) as { id: string; subject_id: string; ordinal: number }[];
  const goalRows = (goals.data ?? []) as { subject_id: string; unit_id: string | null; status: string }[];

  // Each track with a unit to lay out, and the unit laid out just before it,
  // which must have been started first. A track with none laid out is due.
  const candidates: { subjectId: string; subjectName: string; before: string | null }[] = [];
  for (const subjectId of subjectIds) {
    const subject = subjectRows.find((row) => row.id === subjectId);
    if (!subject) continue;
    if (subject.lessons_held_until && new Date(subject.lessons_held_until) > now) continue;
    const trackUnits = unitRows.filter((unit) => unit.subject_id === subjectId);
    const next = nextUnitToOpen(
      trackUnits,
      goalRows
        .filter((goal) => goal.subject_id === subjectId)
        .map((goal) => ({ unitId: goal.unit_id, status: goal.status })),
    );
    if (!next) continue;
    const before = trackUnits
      .filter((unit) => unit.ordinal < next.ordinal)
      .sort((a, b) => b.ordinal - a.ordinal)[0];
    candidates.push({ subjectId, subjectName: subject.name, before: before?.id ?? null });
  }

  const started = await loadUnitsStarted(
    learn,
    userId,
    candidates.flatMap((one) => (one.before ? [one.before] : [])),
  );
  return candidates
    .filter((one) => one.before === null || started.has(one.before))
    .slice(0, limit)
    .map(({ subjectId, subjectName }) => ({ subjectId, subjectName }));
}

