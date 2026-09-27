import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { HANDIN_COLUMNS, type HandInRow } from './practice';
import { PROJECT_COLUMNS, toProjectView, type ProjectRow, type ProjectView } from './project';

/**
 * The reads behind a plan's final project (plan #1146). Every query names the
 * person.
 */

/** The plan's project as stored, or null before its brief is written. */
export async function loadProjectRow(
  learn: LearnSupabaseClient,
  userId: string,
  subjectId: string,
): Promise<ProjectRow | null> {
  const { data, error } = await learn
    .from('plan_projects')
    .select(PROJECT_COLUMNS)
    .eq('user_id', userId)
    .eq('subject_id', subjectId)
    .maybeSingle();
  if (error) throw new Error(`Reading the final project failed: ${error.message}`);
  return (data as ProjectRow | null) ?? null;
}

/** The project as the plan page shows it: its latest hand-in and whether any has passed. */
export async function projectViewOf(
  learn: LearnSupabaseClient,
  userId: string,
  row: ProjectRow,
): Promise<ProjectView> {
  const [latest, passed] = await Promise.all([
    learn
      .from('plan_project_handins')
      .select(HANDIN_COLUMNS)
      .eq('user_id', userId)
      .eq('project_id', row.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    learn
      .from('plan_project_handins')
      .select('id')
      .eq('user_id', userId)
      .eq('project_id', row.id)
      .eq('passed', true)
      .limit(1),
  ]);
  if (latest.error) throw new Error(`Reading what was handed in failed: ${latest.error.message}`);
  if (passed.error) throw new Error(`Reading what was handed in failed: ${passed.error.message}`);
  return toProjectView(row, (latest.data as HandInRow | null) ?? null, (passed.data ?? []).length > 0);
}

/** The plan's project as the page shows it, or null before its brief is written. */
export async function loadProjectView(
  learn: LearnSupabaseClient,
  userId: string,
  subjectId: string,
): Promise<ProjectView | null> {
  const row = await loadProjectRow(learn, userId, subjectId);
  return row ? projectViewOf(learn, userId, row) : null;
}

/** Of these tracks, the ones whose final project has a hand-in that passed. */
export async function loadProjectsPassed(
  learn: LearnSupabaseClient,
  userId: string,
  subjectIds: readonly string[],
): Promise<Set<string>> {
  const passed = new Set<string>();
  if (subjectIds.length === 0) return passed;
  const { data: projects, error } = await learn
    .from('plan_projects')
    .select('id, subject_id')
    .eq('user_id', userId)
    .in('subject_id', [...subjectIds]);
  if (error) throw new Error(`Reading the final projects failed: ${error.message}`);
  const subjectOf = new Map(((projects ?? []) as { id: string; subject_id: string }[]).map((row) => [row.id, row.subject_id]));
  if (subjectOf.size === 0) return passed;
  const { data, error: handInError } = await learn
    .from('plan_project_handins')
    .select('project_id')
    .eq('user_id', userId)
    .eq('passed', true)
    .in('project_id', [...subjectOf.keys()]);
  if (handInError) throw new Error(`Reading what was handed in failed: ${handInError.message}`);
  for (const row of (data ?? []) as { project_id: string }[]) {
    const subjectId = subjectOf.get(row.project_id);
    if (subjectId) passed.add(subjectId);
  }
  return passed;
}
