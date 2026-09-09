import type { SupabaseClient } from '@supabase/supabase-js';
import { planStepKey, seedStepsNotYetOffered, type PlanSeedItem } from '@/lib/plan/seed';

/**
 * Bringing steps written in the seed into the plan, without being asked.
 *
 * The plan used to be a one-shot import: press the button on an empty page and
 * the build order is written in, refuse to do anything ever after. That made
 * the seed a dead end. New slices get planned where the specs live -- in a
 * file, next to the argument for them -- and under the old rule each one had to
 * be retyped into a form to reach the page it is meant to be worked on. A plan
 * page that lags the plan is one you stop opening.
 *
 * So this runs on the way into the page. Two rules keep that honest:
 *
 * A step is offered once. `plan_seed_imports` records every key the seed has
 * ever handed over, which is a different question from what the plan currently
 * holds. Delete a step you decided against and it stays deleted -- the key is
 * still recorded, so it is never offered again. Without that separation an
 * automatic sync would hand back everything you rejected, on every page load,
 * with no way to refuse it.
 *
 * Nothing already there is touched. The sync only ever inserts. A step you
 * marked done stays done, a comment you wrote stays written, a title you
 * rewrote is left alone -- and because a rewritten title makes a different key,
 * the original is not offered again either.
 */

export type PlanSyncResult = {
  /** How many steps were written in. Zero is the normal case. */
  added: number;
  /**
   * Why nothing happened, when something should have. Carried rather than
   * thrown: a plan you cannot sync is still a plan you can read, and the page
   * says so in a line instead of failing.
   */
  error?: string;
};

/** A plan row, as much of it as positioning needs. */
type PositionedRow = { module: string | null; position: number | null };

/**
 * Where each new step goes: after whatever its module already has, spaced by
 * ten so one can later be slotted between two others without renumbering.
 *
 * Pure, and separate from the write, because this is the part with an answer
 * that can be wrong. On an empty plan it produces 10, 20, 30 within each
 * module, which is the numbering the original import produced.
 */
export function positionsForNewSteps(
  existing: readonly PositionedRow[],
  steps: readonly PlanSeedItem[],
): number[] {
  const lastByModule = new Map<string, number>();
  for (const row of existing) {
    const key = row.module ?? 'app';
    lastByModule.set(key, Math.max(lastByModule.get(key) ?? 0, row.position ?? 0));
  }

  return steps.map((step) => {
    const key = step.module ?? 'app';
    const next = (lastByModule.get(key) ?? 0) + 10;
    lastByModule.set(key, next);
    return next;
  });
}

/**
 * Claim the keys, then write the steps.
 *
 * That order is the whole race protection. Two requests arriving together --
 * a prefetch on hover and the click that follows it -- both compute the same
 * missing steps. The claim is an insert against a primary key with duplicates
 * ignored, and `.select()` returns only the rows this request actually
 * inserted, so the loser comes back with nothing and writes nothing. Doing it
 * the other way round would duplicate every new step.
 */
export async function syncPlanFromSeed(
  supabase: SupabaseClient,
  userId: string,
): Promise<PlanSyncResult> {
  const seen = await supabase.from('plan_seed_imports').select('step_key').eq('user_id', userId);
  if (seen.error) return { added: 0, error: seen.error.message };

  const missing = seedStepsNotYetOffered((seen.data ?? []).map((row) => row.step_key as string));
  if (missing.length === 0) return { added: 0 };

  const claimed = await supabase
    .from('plan_seed_imports')
    .upsert(
      missing.map((step) => ({ user_id: userId, step_key: planStepKey(step) })),
      { onConflict: 'user_id,step_key', ignoreDuplicates: true },
    )
    .select('step_key');
  if (claimed.error) return { added: 0, error: claimed.error.message };

  const keys = new Set((claimed.data ?? []).map((row) => row.step_key as string));
  const mine = missing.filter((step) => keys.has(planStepKey(step)));
  if (mine.length === 0) return { added: 0 };

  // Read the plan only now, and only because positions depend on it. Reading it
  // before the claim would widen the window the claim exists to close.
  const plan = await supabase
    .from('plan_items')
    .select('module, position')
    .eq('user_id', userId);
  if (plan.error) return { added: 0, error: plan.error.message };

  const positions = positionsForNewSteps((plan.data ?? []) as PositionedRow[], mine);

  const written = await supabase.from('plan_items').insert(
    mine.map((step, index) => ({
      user_id: userId,
      module: step.module,
      title: step.title,
      detail: step.detail,
      status: step.status,
      position: positions[index],
    })),
  );
  if (written.error) return { added: 0, error: written.error.message };

  return { added: mine.length };
}
