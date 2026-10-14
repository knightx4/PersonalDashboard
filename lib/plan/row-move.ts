import type { SupabaseClient } from '@supabase/supabase-js';
import type { Move } from '@/lib/core/move';
import { moveFor } from '@/lib/plan/health-words';
import { ITEM_COLUMNS, planItemFromRow, type PlanCheckWait, type PlanDependency } from '@/lib/plan/load';
import { stepRef } from '@/lib/plan/ref';
import { buildPlanTree, findNode, moveOf } from '@/lib/plan/tree';

/**
 * One plan row's move, for the preview a ref link shows (plan #1931.4).
 *
 * The plan's move is worked out over a row and everything beneath it, and a
 * step waits on the steps it depends on, so this reads the row's whole
 * feature and the rows its steps wait on, then asks the same `moveOf` and
 * `moveFor` the plan page does. Reading the whole plan for one hover would
 * be two thousand rows; a feature is a few dozen.
 *
 * Runs in progress are not read, so a claimed step reads "With Dash" rather
 * than "Dash is on it". That is the one difference from the plan page.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public'>;

export type PlanRowPlace = { id: string; number: number; outline: string };

/**
 * A step found by its id, number or outline, with its outline. The outlines
 * view (plan_item_outlines) numbers every row the way the plan page does.
 */
export async function findPlanRow(
  supabase: Db,
  userId: string,
  by: { id: string } | { number: number } | { outline: string },
): Promise<PlanRowPlace | null> {
  let query = supabase.from('plan_item_outlines').select('id, number, outline').eq('user_id', userId);
  if ('id' in by) query = query.eq('id', by.id);
  else if ('number' in by) query = query.eq('number', by.number);
  else query = query.eq('outline', by.outline);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`plan_item_outlines: ${error.message}`);
  if (!data) return null;
  return { id: data.id as string, number: Number(data.number), outline: String(data.outline) };
}

export async function loadPlanRowMove(
  supabase: Db,
  userId: string,
  row: PlanRowPlace,
): Promise<{ move: Move | null; title?: string }> {
  const root = row.outline.split('.')[0];
  const { data: placed, error } = await supabase
    .from('plan_item_outlines')
    .select('id, number, outline')
    .eq('user_id', userId)
    .or(`outline.eq.${root},outline.like.${root}.%`);
  if (error) throw new Error(`plan_item_outlines: ${error.message}`);
  const outlines = new Map<number, string>();
  for (const place of placed ?? []) outlines.set(Number(place.number), String(place.outline));
  const ids = (placed ?? []).map((place) => place.id as string);
  if (ids.length === 0) return { move: null };

  const [items, deps, checks] = await Promise.all([
    supabase.from('plan_items').select(ITEM_COLUMNS).eq('user_id', userId).in('id', ids),
    supabase
      .from('plan_dependencies')
      .select('id, item_id, depends_on_id')
      .eq('user_id', userId)
      .in('item_id', ids),
    supabase
      .from('check_backs')
      .select('id, plan_item_id, title, due_at')
      .eq('user_id', userId)
      .eq('status', 'waiting')
      .in('plan_item_id', ids),
  ]);
  if (items.error) throw new Error(`plan_items: ${items.error.message}`);
  if (deps.error) throw new Error(`plan_dependencies: ${deps.error.message}`);

  const dependencies: PlanDependency[] = ((deps.data ?? []) as Record<string, unknown>[]).map((dep) => ({
    id: dep.id as string,
    itemId: dep.item_id as string,
    dependsOnId: dep.depends_on_id as string,
  }));
  // The rows waited on that sit under another feature, read so a wait on
  // them is a wait; they stand in the tree as rows of their own.
  const inTree = new Set(ids);
  const outside = [...new Set(dependencies.map((dep) => dep.dependsOnId))].filter((id) => !inTree.has(id));
  const others = outside.length
    ? await supabase.from('plan_items').select(ITEM_COLUMNS).eq('user_id', userId).in('id', outside)
    : { data: [], error: null };
  if (others.error) throw new Error(`plan_items: ${others.error.message}`);

  const rows = [...((items.data ?? []) as unknown[]), ...((others.data ?? []) as unknown[])] as Record<
    string,
    unknown
  >[];
  // A row from another feature has no parent here, so it is not hung under
  // one of this feature's rows by accident.
  const checkWaits: PlanCheckWait[] = checks.error
    ? []
    : ((checks.data ?? []) as Record<string, unknown>[]).map((check) => ({
        id: check.id as string,
        planItemId: check.plan_item_id as string,
        title: check.title as string,
        dueAt: check.due_at as string,
      }));

  const sections = buildPlanTree({
    items: rows.map((item) => planItemFromRow(inTree.has(item.id as string) ? item : { ...item, parent_id: null })),
    dependencies,
    checkWaits,
  });
  const node = findNode(sections, row.id);
  if (!node) return { move: null };

  const move = moveOf(node);
  const own = moveOf({ ...node, children: [] });
  const first = node.waitingOn[0];
  const waitingOn = first
    ? `${stepRef({ number: first.number, outline: outlines.get(first.number) })} ${first.title}`
    : undefined;
  const said = moveFor(move, own, waitingOn);
  return { move: said.move, title: said.title };
}
