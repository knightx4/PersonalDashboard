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
 *
 * The app as a whole has one too, stored under the key `app` in the same
 * table. It is what a step with no workspace is briefed with, and it sits at
 * the head of the specs page's app-wide group. `app` is not a module id, so
 * the key cannot collide with a workspace's.
 *
 * Not `server-only`: the plan brief reads these through `scripts/plan.ts`,
 * which runs outside Next, and nothing here does more than a query through
 * the client it is handed.
 */

/** The key the app-wide vision is stored under in `module_visions.module`. */
export const APP_VISION = 'app' as const;

/** What a vision can be written for: a workspace, or the app as a whole. */
export type VisionScope = ModuleId | typeof APP_VISION;

export type ModuleVision = {
  module: VisionScope;
  body: string;
  updatedAt: string;
};

/**
 * The element on the specs page a vision is drawn in, so a search hit on one
 * can land at it (plan #1155).
 */
export function visionAnchor(scope: string): string {
  return `vision-${scope}`;
}

/** Every vision this person has written, by workspace, with the app's under `app`. */
export async function loadModuleVisions(
  supabase: SupabaseClient,
  userId: string,
): Promise<Partial<Record<VisionScope, ModuleVision>>> {
  const { data } = await supabase
    .from('module_visions')
    .select('module, body, updated_at')
    .eq('user_id', userId);

  const visions: Partial<Record<VisionScope, ModuleVision>> = {};
  for (const row of (data ?? []) as { module: string; body: string; updated_at: string }[]) {
    visions[row.module as VisionScope] = {
      module: row.module as VisionScope,
      body: row.body,
      updatedAt: row.updated_at,
    };
  }
  return visions;
}

/** Just the text of each vision, by scope: the shape a plan brief is handed. */
export type VisionBodies = Partial<Record<VisionScope, string>>;

export async function loadVisionBodies(
  supabase: SupabaseClient,
  userId: string,
): Promise<VisionBodies> {
  const visions = await loadModuleVisions(supabase, userId);
  const bodies: VisionBodies = {};
  for (const [scope, vision] of Object.entries(visions)) {
    if (vision) bodies[scope as VisionScope] = vision.body;
  }
  return bodies;
}
