import type { SchemaClient } from '@/lib/ask/db';
import type { ModuleId } from '@/lib/modules';

/**
 * Filing one idea on the ideas page, as the page's box, the header panel,
 * Dash's add_idea and a comment's file_idea all do it (plan #2473.5). The
 * body comes in trimmed and checked. `source` is 'claude' for an idea Dash
 * suggests itself and left out for one the person asked for, and
 * `fromPlanItemId` names the plan step a comment filed it from. Returns the
 * new idea's id.
 */
export async function insertIdea(
  supabase: SchemaClient,
  idea: { userId: string; body: string; module: ModuleId | string | null; source?: 'claude'; fromPlanItemId?: string | null },
): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase
    .from('ideas')
    .insert({
      user_id: idea.userId,
      body: idea.body,
      module: idea.module,
      ...(idea.source ? { source: idea.source } : {}),
      ...(idea.fromPlanItemId !== undefined ? { from_plan_item_id: idea.fromPlanItemId } : {}),
    })
    .select('id')
    .maybeSingle();
  if (error) return { id: null, error: error.message };
  return { id: ((data as { id: string } | null)?.id as string | undefined) ?? null, error: null };
}
