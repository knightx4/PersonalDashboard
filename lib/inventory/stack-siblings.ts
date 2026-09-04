/**
 * Every copy that counts as the same item as this one.
 *
 * The item page edits the item, not the box you happened to open: a name, a
 * category or a template field describes the product, so saving it has to
 * reach all three copies of Acquire rather than only the one whose URL you are
 * on. This is the query behind that.
 *
 * It reads every owned unit and stacks them rather than filtering in SQL,
 * because "the same item" is only partly a column — most stacking is derived
 * (lib/inventory/item-groups.ts) and cannot be expressed as a where clause.
 * Inventories are hundreds of rows, not millions, and the alternative is the
 * page and the save disagreeing about what one item is.
 */
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { stackContaining, stackUnits } from '@/lib/inventory/item-groups';

const SELECT = `
  id, name, short_name, cost_cents, acquired_at, fingerprint_loose, group_id,
  game_details ( bgg_id, needs_confirmation )
`;

type Row = {
  id: string;
  name: string;
  short_name: string | null;
  cost_cents: number;
  acquired_at: string | null;
  fingerprint_loose: string | null;
  group_id: string | null;
  game_details:
    | { bgg_id: number | null; needs_confirmation: boolean }
    | { bgg_id: number | null; needs_confirmation: boolean }[]
    | null;
};

/**
 * The ids of every copy in `inventoryItemId`'s stack, including itself.
 *
 * Falls back to just the one id if anything is missing, so a save never
 * silently reaches fewer rows than the caller thinks — or more.
 */
export async function stackSiblingIds(
  supabase: SupabaseClient,
  userId: string,
  inventoryItemId: string,
): Promise<string[]> {
  const [{ data: rows }, { data: groups }] = await Promise.all([
    supabase.from('inventory_items').select(SELECT).eq('user_id', userId).eq('status', 'owned'),
    supabase.from('item_groups').select('id, name, group_key').eq('user_id', userId),
  ]);

  const units = ((rows ?? []) as unknown as Row[]).map((row) => {
    const game = Array.isArray(row.game_details) ? row.game_details[0] : row.game_details;
    return {
      inventoryItemId: row.id,
      name: row.name,
      shortName: row.short_name,
      bggId: game?.bgg_id ?? null,
      needsConfirmation: Boolean(game?.needs_confirmation),
      isGame: Boolean(game),
      fingerprintLoose: row.fingerprint_loose,
      groupId: row.group_id,
      costCents: row.cost_cents,
      acquiredAt: row.acquired_at,
    };
  });

  const stack = stackContaining(
    stackUnits(
      units,
      (groups ?? []).map((group) => ({
        id: group.id as string,
        name: group.name as string,
        groupKey: (group.group_key as string | null) ?? null,
      })),
    ),
    inventoryItemId,
  );

  return stack ? stack.units.map((unit) => unit.inventoryItemId) : [inventoryItemId];
}
