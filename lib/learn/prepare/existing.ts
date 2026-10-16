/**
 * Which subjects made before the preparation existed get one (plan #2276.8).
 *
 * Pure, so the script that opens the runs and the tests share one rule.
 * A subject is prepared unless it is a survey stub, it is already prepared, or
 * it already has drafted topics on its lens (SaaS metrics once #2247.15 has
 * redrafted it); naming it overrides the last one. Its opening units are put
 * up for replacement only when they plainly came from the add: all written by
 * Dash, few, and with no piece against any of them. A subject whose units have
 * been outlined into pieces keeps them, since replacing a unit removes its pieces.
 */

export type ExistingUnit = { writtenByDash: boolean; pieces: number };

export type ExistingSubject = {
  id: string;
  name: string;
  survey: boolean;
  runStatus: 'pending' | 'running' | 'done' | 'failed' | null;
  /** Targets on the subject's own lens, which is what drafted topics leave behind. */
  lensTargets: number;
  units: ExistingUnit[];
};

export type ExistingPlan = {
  id: string;
  name: string;
  action: 'open' | 'skip';
  reason: string;
  /** The units the add wrote can be replaced by write_units. */
  replaceUnits: boolean;
};

/** An add writes three or four opening units; more than this came from somewhere else. */
export const ADD_UNIT_MAX = 4;

export function unitsFromTheAdd(units: readonly ExistingUnit[]): boolean {
  return units.length > 0 && units.length <= ADD_UNIT_MAX && units.every((u) => u.writtenByDash && u.pieces === 0);
}

export function planExisting(subjects: readonly ExistingSubject[], named: readonly string[] = []): ExistingPlan[] {
  const wanted = new Set(named.map((n) => n.trim().toLowerCase()));
  const pick = (s: ExistingSubject) => wanted.has(s.name.trim().toLowerCase()) || wanted.has(s.id);
  return subjects
    .filter((s) => wanted.size === 0 || pick(s))
    .map((s): ExistingPlan => {
      const base = { id: s.id, name: s.name, replaceUnits: unitsFromTheAdd(s.units) };
      if (s.survey) return { ...base, action: 'skip', reason: 'A survey stub, not a subject to study.', replaceUnits: false };
      if (s.runStatus === 'done') return { ...base, action: 'skip', reason: 'Already prepared.', replaceUnits: false };
      if (s.lensTargets > 0 && !pick(s)) {
        return { ...base, action: 'skip', reason: `Already has ${s.lensTargets} drafted topics; name it to prepare it anyway.`, replaceUnits: false };
      }
      return { ...base, action: 'open', reason: s.runStatus ? `Run is ${s.runStatus}; carried on.` : 'No run yet; opens one.' };
    });
}
