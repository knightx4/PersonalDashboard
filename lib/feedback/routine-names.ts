/**
 * The routines a button can hand work to, by name (plan #2459.1).
 *
 * A press that fires a routine is not priced on its own: the routine runs on
 * the account's plan, not on the spend ledger, so its button has no figure to
 * show. It shows the $ all the same, and opening it names the routine and says
 * so (DashAction's `routine`, CostHint's `routine`).
 *
 * The keys are the routines lib/feedback/routine.ts fires, one per function
 * there; `ROUTINE_FIRES` in that file is typed against this list, so a
 * routine added there without a name here, or named here without a function
 * there, fails the type check. This file holds only the names because that one
 * is server-only and these are drawn in the browser.
 */
export const ROUTINE_LABELS = {
  notes: 'Notes',
  plan: 'Plan',
  review: 'Review',
  goals: 'Goals',
  vision: 'Vision',
  spec_audit: 'Spec audit',
  dash_backup: 'Dash backup',
  overhaul: 'Overhaul',
  project: 'Project',
} as const;

export type RoutineKey = keyof typeof ROUTINE_LABELS;

export const ROUTINE_KEYS = Object.keys(ROUTINE_LABELS) as RoutineKey[];

/** "Runs on the Goals routine." */
export function routineRunsOn(routine: RoutineKey): string {
  return `Runs on the ${ROUTINE_LABELS[routine]} routine.`;
}

/** The second line of the hint: why there is no figure. */
export const ROUTINE_NOT_PRICED = 'Not priced per press.';
