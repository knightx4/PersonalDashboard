import 'server-only';

import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import type { HelpKindChoice } from '@/lib/goals/help-kinds';

/**
 * Replace the kinds of weekly help a live goal asks for (plan #1027). The
 * whole list is written at once, in the order given, so an empty list clears
 * it. False when the goal is gone or archived, so a stale page writes
 * nothing. The history trigger records the change like any other.
 *
 * Saving settles the goal's weekly help (plan #1029): any kinds Claude
 * proposed are cleared, whether this save approved them, changed them or
 * chose others, and mapping the goal again proposes none.
 */
export async function setGoalHelpKinds(
  client: GoalsSupabaseClient,
  goalId: string,
  choices: HelpKindChoice[],
): Promise<boolean> {
  const { data, error } = await client
    .from('items')
    .update({
      help_kinds: choices.map(({ kind, note }) => ({ kind, note })),
      proposed_help_kinds: [],
      help_kinds_settled_at: new Date().toISOString(),
    })
    .eq('id', goalId)
    .eq('level', 'goal')
    .is('archived_at', null)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/**
 * Turn down the kinds of weekly help Claude proposed for a goal (plan #1029),
 * leaving the ones already chosen as they are. Settles the goal's help, so the
 * next mapping run does not propose them again. False when the goal is gone,
 * archived or has no proposal waiting.
 */
export async function turnDownHelpProposal(
  client: GoalsSupabaseClient,
  goalId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from('items')
    .update({ proposed_help_kinds: [], help_kinds_settled_at: new Date().toISOString() })
    .eq('id', goalId)
    .eq('level', 'goal')
    .is('archived_at', null)
    .neq('proposed_help_kinds', '[]')
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}
