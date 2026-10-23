import type { SchemaClient } from '@/lib/ask/db';
import { blockPatch, isPlanBlockKind, type PlanStatus } from '@/lib/plan/load';

/** What the database's refusals say, in words the page and the thread can show. */
export function friendlyPlanError(message: string): string {
  if (/plan_dependencies_pair_key/.test(message)) return 'It already waits on that step.';
  return message;
}

/** The columns of a step the step form saves. Where it sits is the caller's to work out. */
export type PlanItemEdit = {
  title?: string;
  detail?: string | null;
  acceptance?: string | null;
  comment?: string | null;
  commit_sha?: string | null;
  status?: PlanStatus;
  priority?: number;
  size?: string | null;
  assignee?: string | null;
  parent_id?: string | null;
  module?: string | null;
  position?: number;
};

/**
 * Saving a step, as the plan page's step form and a comment's reword both do
 * it (plan #2473.9). Only the columns given are written. A new status brings
 * its block columns with it (blockPatch), and a step already blocked keeps
 * the kind it was blocked with: rewriting the kind because somebody fixed a
 * typo would turn a block that clears itself into one that does not. A step
 * that is not there, or is somebody else's, is refused.
 */
export async function editPlanItem(
  supabase: SchemaClient,
  step: { userId: string; id: string; fields: PlanItemEdit },
): Promise<{ ok: true } | { error: string }> {
  const patch: Record<string, unknown> = { ...step.fields };
  if (step.fields.status !== undefined) {
    const { data: current } = await supabase
      .from('plan_items')
      .select('block_kind')
      .eq('user_id', step.userId)
      .eq('id', step.id)
      .maybeSingle();
    const stored = (current as { block_kind: string | null } | null)?.block_kind ?? null;
    Object.assign(patch, blockPatch(step.fields.status, stored && isPlanBlockKind(stored) ? stored : null));
  }
  return writePlanRow(supabase, step.userId, step.id, patch, 'That step no longer exists.');
}

/** The columns of a feature its compose surface saves. Its status, note and place keep their own controls. */
export type FeatureEdit = {
  title?: string;
  summary?: string | null;
  detail?: string | null;
  acceptance?: string | null;
  priority?: number;
  size?: string | null;
  assignee?: string | null;
};

/**
 * Saving a feature's wording and properties, as the compose surface on its
 * page and a comment's reword both do it (plan #2473.9). Only the columns
 * of `FeatureEdit`, so a save never rewrites its status, note or place.
 */
export async function editFeature(
  supabase: SchemaClient,
  feature: { userId: string; id: string; fields: FeatureEdit },
): Promise<{ ok: true } | { error: string }> {
  const { title, summary, detail, acceptance, priority, size, assignee } = feature.fields;
  const patch = Object.fromEntries(
    Object.entries({ title, summary, detail, acceptance, priority, size, assignee }).filter(([, value]) => value !== undefined),
  );
  return writePlanRow(supabase, feature.userId, feature.id, patch, 'That feature no longer exists.');
}

async function writePlanRow(
  supabase: SchemaClient,
  userId: string,
  id: string,
  patch: Record<string, unknown>,
  gone: string,
): Promise<{ ok: true } | { error: string }> {
  const { data, error } = await supabase
    .from('plan_items')
    .update(patch)
    .eq('id', id)
    .eq('user_id', userId)
    .select('id');
  if (error) return { error: friendlyPlanError(error.message) };
  if (!data || (data as unknown[]).length === 0) return { error: gone };
  return { ok: true };
}
