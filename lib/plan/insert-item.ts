import type { SchemaClient } from '@/lib/ask/db';
import { blockPatch, type PlanStatus } from '@/lib/plan/load';

/**
 * Writing one new plan row, as the plan page's Add and a comment's add_step
 * and build_step all do it (plan #2473.5). Where it goes (its module, its
 * parent, its position) is the caller's to work out first, through
 * nextPlanPosition. A row written straight into blocked still has to say
 * which kind of block it is, so it takes the default (blockPatch). Returns
 * the new row's id and number.
 */
export async function insertPlanItem(
  supabase: SchemaClient,
  row: {
    userId: string;
    module: string | null;
    parentId: string | null;
    title: string;
    detail: string | null;
    acceptance?: string | null;
    status: PlanStatus;
    kind: string;
    priority?: number;
    size?: string | null;
    assignee?: string | null;
    position: number;
  },
): Promise<{ id: string; number: number } | { error: string }> {
  const { data, error } = await supabase
    .from('plan_items')
    .insert({
      user_id: row.userId,
      module: row.module,
      parent_id: row.parentId,
      title: row.title,
      detail: row.detail,
      ...(row.acceptance !== undefined ? { acceptance: row.acceptance } : {}),
      status: row.status,
      kind: row.kind,
      ...blockPatch(row.status),
      ...(row.priority !== undefined ? { priority: row.priority } : {}),
      ...(row.size !== undefined ? { size: row.size } : {}),
      ...(row.assignee !== undefined ? { assignee: row.assignee } : {}),
      position: row.position,
    })
    .select('id, number')
    .maybeSingle();
  if (error) return { error: error.message };
  const written = data as { id: string; number: number } | null;
  return written ? { id: written.id, number: written.number } : { error: 'The step was not written.' };
}
