/**
 * The fixed steps every subject is prepared through (plan #2276).
 *
 * Pure, so the subject page (#2276.2) can draw the list before a step's code
 * has landed. The keys are also in the trigger that opens a run
 * (supabase/migrations-learn/0167_subject_preparations.sql) and in its check
 * constraint; steps.test.ts holds the two lists equal.
 */

export const PREPARATION_STEPS = [
  'classify',
  'pull_documents',
  'match_weeks',
  'compile_territory',
  'draft_topics',
  'write_units',
  'finish',
] as const;

export type PreparationStepKey = (typeof PREPARATION_STEPS)[number];

export function isPreparationStepKey(value: unknown): value is PreparationStepKey {
  return typeof value === 'string' && (PREPARATION_STEPS as readonly string[]).includes(value);
}

export type PreparationStatus = 'pending' | 'running' | 'done' | 'failed';
export type PreparationStepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed';

/** What the page calls each step, and the plan step that builds its code. */
export const PREPARATION_STEP_LABELS: Record<PreparationStepKey, { label: string; builtBy: string }> = {
  classify: { label: 'Work out what kind of subject this is', builtBy: '#2276.3' },
  pull_documents: { label: 'Find syllabi and other structure documents', builtBy: '#2276.3' },
  match_weeks: { label: 'Match the weeks that cover it', builtBy: '#2276.3' },
  compile_territory: { label: 'Lay out the territory', builtBy: '#2276.4' },
  draft_topics: { label: 'Draft the topics and their checks', builtBy: '#2276.5' },
  write_units: { label: 'Write the opening units', builtBy: '#2276.5' },
  finish: { label: 'Finish', builtBy: '#2276.1' },
};

/** The line a step gets when its code is not on main yet. */
export function notBuiltReason(key: PreparationStepKey): string {
  return `Skipped: this step's code arrives with ${PREPARATION_STEP_LABELS[key].builtBy}.`;
}
