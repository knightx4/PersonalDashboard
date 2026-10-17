import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { isGoalKind, KIND_REASON_MAX, type GoalKind, type GoalKindBy } from '@/lib/learn/goal-kind';

/**
 * Where a subject's kind is kept (plan #2247.2, moved to the subject by
 * #2302.2).
 *
 * The kind sits on learn.subjects (learn 0167). The preparation's classify
 * step fills it in for a subject with none (lib/learn/prepare/handlers.ts); a
 * goal reads the kind of the subject it points at, and the goal's page changes
 * it there. `aims.kind` is left as it was and nothing writes it any more.
 */

export type SubjectKind = { kind: GoalKind | null; reason: string | null; by: GoalKindBy | null };

/** The subject's kind as it stands; all null for a subject not sorted yet or not found. */
export async function loadSubjectKind(supabase: LearnSupabaseClient, subjectId: string): Promise<SubjectKind> {
  const { data, error } = await supabase
    .from('subjects')
    .select('kind, kind_reason, kind_by')
    .eq('id', subjectId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the subject's kind: ${error.message}`);
  const row = data as { kind: string | null; kind_reason: string | null; kind_by: string | null } | null;
  return {
    kind: isGoalKind(row?.kind) ? row.kind : null,
    reason: row?.kind_reason ?? null,
    by: row?.kind_by === 'person' || row?.kind_by === 'model' ? row.kind_by : null,
  };
}

/**
 * The person changes a subject's kind, and optionally its reason. Their choice
 * is kept against the classify step. False when no subject of theirs matched.
 */
export async function setSubjectKind(
  supabase: LearnSupabaseClient,
  subjectId: string,
  kind: GoalKind,
  reason?: string,
): Promise<boolean> {
  const note = reason?.replace(/\s+/g, ' ').trim().slice(0, KIND_REASON_MAX);
  const { data, error } = await supabase
    .from('subjects')
    .update({
      kind,
      kind_reason: note ? note : 'Set by you.',
      kind_by: 'person',
      kind_model: null,
      kind_at: new Date().toISOString(),
    })
    .eq('id', subjectId)
    .select('id');
  if (error) throw new Error(`Could not change the subject's kind: ${error.message}`);
  return (data ?? []).length > 0;
}
