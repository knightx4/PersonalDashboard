/**
 * Putting copies of one thing under one item, as the inventory's bulk bar
 * does and as Dash does when asked (plan #1656). The server actions in
 * app/shopping/inventory/group-actions.ts and Dash's change_items write both
 * call groupUnits, so the two cannot drift on which copy names the group.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { groupKeyFor, type GroupableItem } from '@/lib/share/grouping';

export const UNIT_SELECT = `
  id, name, short_name, fingerprint_loose, group_id, acquired_at,
  game_details ( bgg_id, needs_confirmation )
`;

function first<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export type UnitRow = {
  id: string;
  name: string;
  short_name: string | null;
  fingerprint_loose: string | null;
  group_id: string | null;
  acquired_at: string | null;
  game_details: unknown;
};

/**
 * Oldest first, then by id — the same total order stackUnits uses to pick a
 * stack's primary, so the copy that names the new group is the copy the list
 * and the page already treat as standing for the item.
 */
export function byAge(a: UnitRow, b: UnitRow): number {
  const left = a.acquired_at ?? '';
  const right = b.acquired_at ?? '';
  if (left !== right) {
    if (!left) return 1;
    if (!right) return -1;
    return left.localeCompare(right);
  }
  return a.id.localeCompare(b.id);
}

export function groupable(row: UnitRow): GroupableItem {
  const game = first(row.game_details as Record<string, unknown> | Record<string, unknown>[] | null);
  return {
    inventoryItemId: row.id,
    name: row.name,
    shortName: row.short_name,
    bggId: (game?.bgg_id as number | null) ?? null,
    needsConfirmation: Boolean(game?.needs_confirmation),
    isGame: Boolean(game),
    fingerprintLoose: row.fingerprint_loose,
  };
}

export const displayName = (row: Pick<UnitRow, 'name' | 'short_name'>) => row.short_name?.trim() || row.name.trim();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

export type GroupedUnits =
  | {
      ok: true;
      /** The group the copies are under now. */
      groupId: string;
      /** Whether this call made that group, rather than one copy's group absorbing the rest. */
      made: boolean;
      /** The copies put under it, oldest first. */
      ids: string[];
    }
  | { ok: false; error: string };

/**
 * Put the owned copies among `ids` under one item.
 *
 * If any of them is already in a group, that group absorbs the rest rather
 * than a second one appearing beside it — "add these to that item" is what
 * selecting a grouped copy alongside loose ones means.
 *
 * The new group claims the primary copy's derived key so later arrivals of the
 * same thing join it on their own. Claiming is best-effort: another group may
 * already hold that key, and a group with no key still works, it just stops
 * absorbing. Nothing about the copies themselves is rewritten, so ungrouping
 * puts everything back exactly as it was.
 */
export async function groupUnits(supabase: Client, userId: string, ids: readonly string[]): Promise<GroupedUnits> {
  if (ids.length < 2) return { ok: false, error: 'Pick at least two copies to group.' };

  const { data } = await supabase
    .from('inventory_items')
    .select(UNIT_SELECT)
    .eq('user_id', userId)
    .eq('status', 'owned')
    .in('id', [...ids]);
  // Sorted rather than taken in whatever order the query returned them: the
  // first row names the group and donates its derived key, and that must not
  // change between two presses of the same button.
  const rows = ((data ?? []) as unknown as UnitRow[]).sort(byAge);
  if (rows.length < 2) return { ok: false, error: 'Those copies could not be found.' };

  const existing = rows.find((row) => row.group_id)?.group_id ?? null;
  let groupId = existing;

  if (!groupId) {
    const primary = rows[0]!;
    const key = groupKeyFor(groupable(primary));

    const insert = async (groupKey: string | null) =>
      supabase
        .from('item_groups')
        .insert({ user_id: userId, name: displayName(primary), group_key: groupKey })
        .select('id')
        .single();

    let { data: group, error } = await insert(key);
    // 23505: another group already stands for that key. Keep the group, drop
    // the claim — grouping by hand must not fail over an optimisation.
    if (error?.code === '23505') ({ data: group, error } = await insert(null));
    if (error || !group) return { ok: false, error: error?.message ?? 'Could not make that group.' };
    groupId = (group as { id: string }).id;
  }

  const unitIds = rows.map((row) => row.id);
  const { error } = await supabase
    .from('inventory_items')
    .update({ group_id: groupId })
    .eq('user_id', userId)
    .in('id', unitIds);
  if (error) return { ok: false, error: error.message };

  return { ok: true, groupId, made: existing === null, ids: unitIds };
}
