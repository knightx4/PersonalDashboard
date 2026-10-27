/**
 * The first work in a project just added (plan #2553.6, feature #2553).
 *
 * Adding a repository as a Dev project writes a "Set up" feature in its
 * section with one ready step under it: read the repository, find how it
 * installs, tests and builds, record that as the project's check command,
 * commit a short CLAUDE.md where it has none, and say on the step what could
 * not be settled. Pressing Send to Dash on that step sends it to the projects
 * routine like any other project step; the session follows "Setting up a new
 * project" in .claude/skills/plan/reference/project-routine.md, and
 * `scripts/plan.ts project-ready` writes the check command and `set_up_at`
 * onto the row. Every brief after that carries the check command
 * (`projectPreamble` in lib/plan/handover.ts).
 *
 * The feature and the step are written approved (`not_started`): the person
 * asked for the project, and the step only reads the repository and commits a
 * note to it, which is the work every project step does.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { insertPlanItem } from './insert-item';
import type { DevProject } from './projects';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any>;

/** The feature the set-up step sits under. */
export const SET_UP_FEATURE_TITLE = 'Set up';

/** Where the session doing the set-up reads what to do. */
export const SET_UP_SECTION = '"Setting up a new project" in .claude/skills/plan/reference/project-routine.md';

type Row = { title: string; detail: string; acceptance: string };

/** The feature and the step a new project starts with, worded for it. */
export function setUpRows(project: DevProject): { feature: Row; step: Row } {
  const where = `${project.repo.owner}/${project.repo.repo}`;
  const branch = project.repo.branch;
  return {
    feature: {
      title: SET_UP_FEATURE_TITLE,
      detail: `Get ${where} ready for Dash to build its steps in. Written when the project was added.`,
      acceptance: `Dash can build a step in ${where} and run its check before merging to ${branch}.`,
    },
    step: {
      title: `Make ${where} ready for Dash to build in`,
      detail:
        `The first run in this repository. Read it and find how it installs, tests and builds; ` +
        `record that as the project's check command with npx tsx scripts/plan.ts project-ready ` +
        `${project.id} --check "<command>"; commit a short CLAUDE.md to ${branch} if it has none ` +
        `(how to run it, that steps merge to ${branch}, that plan rows live in the dashboard); and ` +
        `say on this step what could not be settled. Push access the session lacks, a secret only ` +
        `you hold or a missing GitHub App install becomes a setup step for you. Follow ` +
        `${SET_UP_SECTION}.`,
      acceptance:
        `${where} has a CLAUDE.md on ${branch}, the project's check command is recorded (or the ` +
        `step says why there is none), and anything only you can supply is a setup step of yours.`,
    },
  };
}

/**
 * Write the "Set up" feature and its step at the end of the project's
 * section. Returns the step's id and number, or why it was not written.
 */
export async function writeSetUpSteps(input: {
  db: Db;
  userId: string;
  project: DevProject;
}): Promise<{ id: string; number: number } | { error: string }> {
  const { db, userId, project } = input;
  const rows = setUpRows(project);

  // After whatever is already at the top of the section: a fresh id has
  // nothing there, but a slug once used by a deleted project might.
  const { data: last } = await db
    .from('plan_items')
    .select('position')
    .eq('user_id', userId)
    .is('parent_id', null)
    .eq('module', project.id)
    .order('position', { ascending: false })
    .limit(1);
  const top = ((last ?? []) as { position?: number }[])[0]?.position ?? 0;

  const feature = await insertPlanItem(db, {
    userId,
    module: project.id,
    parentId: null,
    ...rows.feature,
    status: 'not_started',
    kind: 'build',
    position: top + 10,
  });
  if ('error' in feature) return { error: `The Set up feature was not written: ${feature.error}` };

  const step = await insertPlanItem(db, {
    userId,
    module: project.id,
    parentId: feature.id,
    ...rows.step,
    status: 'not_started',
    kind: 'build',
    size: 'm',
    position: 10,
  });
  if ('error' in step) return { error: `The set-up step was not written: ${step.error}` };
  return step;
}
