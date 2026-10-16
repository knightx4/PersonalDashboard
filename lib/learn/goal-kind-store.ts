import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { AIM_COLUMNS, toAim, type Aim, type AimRow } from '@/lib/learn/aims';
import type { GoalKind } from '@/lib/learn/goal-kind';
import { kindIsStale, KIND_REASON_MAX } from '@/lib/learn/goal-kind';
import { GOAL_KIND_MODEL, classifyGoals } from '@/lib/learn/goal-kind-call';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';

/**
 * Where a goal's kind is kept, and the pass that fills it in (plan #2247.2).
 *
 * The kind sits on learn.aims (0160_aim_kind.sql) beside the placement. The
 * pass runs after a goal in the Learn area is saved, like placement does, and
 * sorts every open goal that has no kind or whose model-chosen kind was read
 * from other wording. A kind the person set is left alone.
 */

export type KindOutcome = { classified: number; failed: number };

/** The open goals the next call sends: no kind yet, or a model's kind gone stale. */
async function goalsNeedingKind(supabase: LearnSupabaseClient): Promise<Aim[]> {
  const { data, error } = await supabase
    .from('aims')
    .select(AIM_COLUMNS)
    .is('archived_at', null)
    .is('list_source', null)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Reading the goals to sort failed: ${error.message}`);
  return ((data ?? []) as AimRow[]).map(toAim).filter(kindIsStale);
}

/**
 * Sort the open goals that need it with one call. Never throws: a goal is
 * worth having unsorted, and the next save tries again. The write lands only
 * on a row still worded as it was sent and not set by the person meanwhile.
 */
export async function classifyAims(
  supabase: LearnSupabaseClient,
  userId: string,
  options: { client?: Anthropic } = {},
): Promise<KindOutcome> {
  let aims: Aim[] = [];
  try {
    aims = await goalsNeedingKind(supabase);
    if (aims.length === 0) return { classified: 0, failed: 0 };

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey && !options.client) return { classified: 0, failed: aims.length };

    const spend = collectSpend();
    const result = await classifyGoals({
      goals: aims.map((aim) => ({ name: aim.name, about: aim.about })),
      anthropicApiKey: apiKey ?? '',
      client: options.client,
      onSpend: spend.sink,
    });
    await recordLearnSpend(userId, 'classify-goal-kind', spend.reports);
    if (!result.ok) {
      console.error('[learn goal-kind]', result.detail);
      return { classified: 0, failed: aims.length };
    }

    let classified = 0;
    for (const answer of result.answers) {
      const aim = aims[answer.goal - 1];
      if (!aim) continue;
      const update = supabase
        .from('aims')
        .update({
          kind: answer.kind,
          kind_reason: answer.reason,
          kind_by: 'model',
          kind_model: GOAL_KIND_MODEL,
          kind_at: new Date().toISOString(),
          kind_read_name: aim.name,
          kind_read_about: aim.about,
        })
        .eq('id', aim.id)
        .eq('name', aim.name)
        .is('archived_at', null)
        .or('kind_by.is.null,kind_by.eq.model');
      const { data, error } = await (aim.about === null
        ? update.is('about', null)
        : update.eq('about', aim.about)
      ).select('id');
      if (error) console.error('[learn goal-kind] write', error.message);
      else if ((data ?? []).length > 0) classified += 1;
    }
    return { classified, failed: aims.length - classified };
  } catch (error) {
    console.error('[learn goal-kind]', error instanceof Error ? error.message : error);
    return { classified: 0, failed: aims.length };
  }
}

/**
 * The person changes a goal's kind, and optionally its reason. Their choice is
 * kept against any later pass. False when no active goal of theirs matched.
 */
export async function setAimKind(
  supabase: LearnSupabaseClient,
  id: string,
  kind: GoalKind,
  reason?: string,
): Promise<boolean> {
  const note = reason?.replace(/\s+/g, ' ').trim().slice(0, KIND_REASON_MAX);
  const { data, error } = await supabase
    .from('aims')
    .update({
      kind,
      kind_reason: note ? note : 'Set by you.',
      kind_by: 'person',
      kind_model: null,
      kind_at: new Date().toISOString(),
    })
    .eq('id', id)
    .is('archived_at', null)
    .select('id');
  if (error) throw new Error(`Could not change the goal's kind: ${error.message}`);
  return (data ?? []).length > 0;
}
