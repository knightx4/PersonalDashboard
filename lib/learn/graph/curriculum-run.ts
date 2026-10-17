import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { openingTerritory } from '@/lib/learn/prepare/draft-steps';
import { loadDraftedNames, loadSubjectTerritory } from '@/lib/learn/prepare/store';
import type { CurriculumTerritory } from './curriculum';
import { parseOwnUnits } from './curriculum-payload';
import { ensureCurriculum, fileGoalUnder, type EnsuredCurriculum } from './curriculum-store';
import { loadGoals, loadSubject } from './load';
import { findOrCreateSubject } from './save';

/**
 * The two Learn presses that write a subject's curriculum, as plain
 * functions: the subject page's Write the curriculum, and Make a subject on
 * Subjects. The buttons' server actions and Dash's paid tools
 * (lib/dash/paid-tools-learn.ts, plan #2228.4) both call these, so the press
 * and the approval do the same work.
 */

export type SubjectCurriculumResult =
  | { ok: true; subject: { id: string; name: string }; written: boolean; units: number }
  | { ok: false; detail: string };

/**
 * The opening of a subject's territory as the curriculum call reads it, the
 * way the preparation's write_units step gives it; null for a subject whose
 * preparation compiled none.
 */
async function subjectTerritory(
  supabase: LearnSupabaseClient,
  userId: string,
  subjectId: string,
): Promise<CurriculumTerritory | null> {
  const territory = await loadSubjectTerritory(supabase, userId, subjectId);
  if (!territory || territory.topics.length === 0) return null;
  const names = await loadDraftedNames(
    supabase,
    userId,
    territory.topics.map((t) => t.ask),
  );
  return openingTerritory(territory, names, []);
}

/**
 * Write the curriculum of a subject that has none, from the question its
 * oldest goal asked (or the subject's note), and file that goal under the unit
 * the question falls in. A subject that already has one keeps it. A prepared
 * subject's units are read off its territory, as the preparation writes them
 * (plan #2307.5), so the course starts where its documents start.
 */
export async function writeSubjectCurriculum(
  supabase: LearnSupabaseClient,
  userId: string,
  subjectId: string,
): Promise<SubjectCurriculumResult> {
  const [subject, goals, territory] = await Promise.all([
    loadSubject(supabase, subjectId),
    loadGoals(supabase, subjectId),
    subjectTerritory(supabase, userId, subjectId),
  ]);
  if (!subject) return { ok: false, detail: 'That subject is gone.' };

  // The oldest goal is what the track was started for.
  const first = goals.at(-1) ?? null;
  const result = await ensureCurriculum(
    supabase,
    userId,
    { id: subject.id, name: subject.name },
    first?.asked ?? subject.note ?? null,
    undefined,
    territory ?? undefined,
  );
  if (!result.ok) return { ok: false, detail: result.detail };
  if (result.goalUnitId && first && !first.unitId) await fileGoalUnder(supabase, first.id, result.goalUnitId);
  return { ok: true, subject: { id: subject.id, name: subject.name }, written: result.written, units: result.units.length };
}

export type CustomSubjectResult =
  | { ok: true; id: string; created: boolean; curriculum: EnsuredCurriculum }
  | { ok: false; detail: string; existing?: { id: string; name: string } };

/**
 * Make a subject by name with its curriculum (LEARN-GRAPH-SPEC, "The
 * curriculum"): the units the person wrote kept in their order, or written by
 * the model when they gave none (for a new subject, the preparation's
 * write_units step, so none are written here). A name they already have goes to that
 * subject, and its curriculum stays as it is. A new subject is not placed here:
 * the insert opened its preparation run (0167), which places it when it
 * finishes (plan #2297.3), so placing it now would pay for it twice.
 */
export async function makeCustomSubject(
  supabase: LearnSupabaseClient,
  userId: string,
  input: { name: string; want: string | null; units: string },
): Promise<CustomSubjectResult> {
  const own = parseOwnUnits(input.units);
  if (!own.ok) return { ok: false, detail: own.detail };
  const { name, want } = input;

  let subject: { id: string; created: boolean; placed: boolean };
  try {
    subject = await findOrCreateSubject(supabase, userId, name);
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'Could not make that subject.' };
  }

  if (subject.created) {
    if (want) await supabase.from('subjects').update({ note: want }).eq('id', subject.id);
  }

  // A subject just made has a preparation run (0167), whose write_units step
  // writes the opening units from the territory. Writing placeholders now
  // would only be deleted minutes later (plan #2276.9), so a new subject with
  // no units of its own gets none here. Units the person typed are still
  // saved, as their own, and that step keeps them in front.
  const preparationWillWrite = subject.created && own.titles.length === 0;
  const curriculum: EnsuredCurriculum = preparationWillWrite
    ? { ok: true, units: [], goalUnitId: null, written: false }
    : await ensureCurriculum(supabase, userId, { id: subject.id, name }, want, own.titles).catch(
        (error: unknown) => ({
          ok: false as const,
          detail: error instanceof Error ? error.message : 'Could not write the curriculum.',
        }),
      );
  // An existing track with a curriculum already keeps it; say so rather than
  // quietly dropping the units that were typed.
  if (!subject.created && curriculum.ok && !curriculum.written && own.titles.length > 0) {
    return {
      ok: false,
      detail: `You already have a subject called ${name}, and its curriculum is fixed.`,
      existing: { id: subject.id, name },
    };
  }
  return { ok: true, id: subject.id, created: subject.created, curriculum };
}
