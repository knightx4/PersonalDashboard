import 'server-only';

import { placeAims } from '@/lib/learn/areas/place-aim';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { giveAimsTracks } from '@/lib/learn/lessons/aim-tracks';

/**
 * What Learn does after a goal in the Learn area is saved on /goals (plan
 * #1490).
 *
 * The database has already carried the goal's wording into its aim (goals
 * 0066), and a new wording cleared the aim's placement. This does what
 * Learn's own Goals page does after a save: places the aim in the area grid,
 * then gives it a track with its outline. A goal outside the Learn area has no
 * aim, and nothing happens.
 *
 * Run after the response. Never throws: a goal is worth having saved even
 * when Learn's follow-up fails, and the next save or top-up tries again.
 */
export async function steerLearnAfterGoalSaved(
  supabase: LearnSupabaseClient,
  userId: string,
  goalId: string,
): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('aims')
      .select('id')
      .eq('goal_id', goalId)
      .is('archived_at', null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return;
    await placeAims(supabase, userId);
    await giveAimsTracks(supabase, userId);
  } catch (error) {
    console.error('[learn goal saved]', error instanceof Error ? error.message : error);
  }
}
