import type { SupabaseClient } from '@supabase/supabase-js';
import { inventoryStatusForDisposal, type DisposalMethod } from './status-actions';

/**
 * Changes to owned inventory units that the inventory's buttons and Dash's
 * change_items write both make (plan #2473.4), so the two cannot drift. Each
 * takes the user explicitly, so it works the same on the page's client (RLS)
 * and on the connector's service role, touches only units still owned, and
 * hands back the ids it wrote.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

export type UnitWrite<T = object> = ({ ok: true; ids: string[] } & T) | { ok: false; error: string };

/** Mark owned units for sale or to return, or clear the mark. */
export async function setUnitsFlag(
  supabase: Client,
  opts: { userId: string; ids: readonly string[]; column: 'for_sale' | 'return_planned'; value: boolean },
): Promise<UnitWrite> {
  if (opts.ids.length === 0) return { ok: true, ids: [] };
  const { data, error } = await supabase
    .from('inventory_items')
    .update({ [opts.column]: opts.value })
    .eq('user_id', opts.userId)
    .eq('status', 'owned')
    .in('id', [...opts.ids])
    .select('id');
  if (error) return { ok: false, error: error.message };
  return { ok: true, ids: ((data ?? []) as { id: string }[]).map((row) => row.id) };
}

/** The columns a disposal writes. */
export type DisposalValues = {
  status: ReturnType<typeof inventoryStatusForDisposal>;
  disposed_at: string;
  disposal_method: DisposalMethod;
  disposal_proceeds_cents: number | null;
};

/** Say they got rid of owned units (sold, gave away, threw out and the rest) on `today`, with what one went for. */
export async function disposeUnits(
  supabase: Client,
  opts: { userId: string; ids: readonly string[]; method: DisposalMethod; proceedsCents: number | null; today: string },
): Promise<UnitWrite<{ values: DisposalValues }>> {
  const values: DisposalValues = {
    status: inventoryStatusForDisposal(opts.method),
    disposed_at: opts.today,
    disposal_method: opts.method,
    disposal_proceeds_cents: opts.proceedsCents && opts.proceedsCents > 0 ? opts.proceedsCents : null,
  };
  if (opts.ids.length === 0) return { ok: true, ids: [], values };
  const { data, error } = await supabase
    .from('inventory_items')
    .update(values)
    .eq('user_id', opts.userId)
    .eq('status', 'owned')
    .in('id', [...opts.ids])
    .select('id');
  if (error) return { ok: false, error: error.message };
  return { ok: true, ids: ((data ?? []) as { id: string }[]).map((row) => row.id), values };
}
