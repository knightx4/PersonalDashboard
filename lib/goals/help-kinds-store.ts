import 'server-only';

import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import type { HelpKindChoice } from '@/lib/goals/help-kinds';

/**
 * Replace the kinds of weekly help a live goal asks for (plan #1027). The
 * whole list is written at once, in the order given, so an empty list clears
 * it. False when the goal is gone or archived, so a stale page writes
 * nothing. The history trigger records the change like any other.
 */
export async function setGoalHelpKinds(
  client: GoalsSupabaseClient,
  goalId: string,
  choices: HelpKindChoice[],
): Promise<boolean> {
  const { data, error } = await client
    .from('items')
    .update({ help_kinds: choices.map(({ kind, note }) => ({ kind, note })) })
    .eq('id', goalId)
    .eq('level', 'goal')
    .is('archived_at', null)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}
