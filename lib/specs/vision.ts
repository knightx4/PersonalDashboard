import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ModuleId } from '@/lib/modules';

/**
 * The vision for a workspace: what it is for, written by the person.
 *
 * Every other document on the specs page is read out of `docs/` and nothing in
 * the app may write one -- migration 0087 argues that at length. This is the
 * one that is not. It sits above the specs rather than beside them: the specs
 * say how a workspace works, and this says what it is for, which is what
 * decides what gets built in it at all.
 *
 * A workspace with nothing written for it has no row, so the map this returns
 * is sparse and the page reads a missing key as "nothing written yet" rather
 * than as an empty paragraph.
 */

export type ModuleVision = {
  module: ModuleId;
  body: string;
  updatedAt: string;
};

/** Every vision this person has written, by workspace. */
export async function loadModuleVisions(
  supabase: SupabaseClient,
  userId: string,
): Promise<Partial<Record<ModuleId, ModuleVision>>> {
  const { data } = await supabase
    .from('module_visions')
    .select('module, body, updated_at')
    .eq('user_id', userId);

  const visions: Partial<Record<ModuleId, ModuleVision>> = {};
  for (const row of (data ?? []) as { module: string; body: string; updated_at: string }[]) {
    visions[row.module as ModuleId] = {
      module: row.module as ModuleId,
      body: row.body,
      updatedAt: row.updated_at,
    };
  }
  return visions;
}
