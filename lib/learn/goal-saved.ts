import 'server-only';

import { placeAims } from '@/lib/learn/areas/place-aim';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { findOrCreateSubject } from '@/lib/learn/graph/save';

/**
 * What Learn does after a goal in the Learn area is saved on /goals (plan
 * #1490, reworked by #2302.2).
 *
 * The database has already carried the goal's wording into its aim (goals
 * 0066), and a new wording cleared the aim's placement. This places the aim in
 * the area grid, then points it at the subject it is about: the subject of
 * that name when there is one, or a new one made from the goal's name and
 * line. A new subject opens its preparation through the learn 0167 trigger and
 * the kick in `findOrCreateSubject`, so it is prepared like any other subject.
 * The goal makes no track, outline, lens or kind of its own: those are the
 * subject's. A goal outside the Learn area has no aim, and nothing happens.
 *
 * Run after the response. Never throws: a goal is worth having saved even
 * when Learn's follow-up fails, and the next save tries again.
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
      .eq('user_id', userId)
      .is('archived_at', null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return;
    await placeAims(supabase, userId);
    await linkAimSubject(supabase, userId, (data as { id: string }).id);
  } catch (error) {
    console.error('[learn goal saved]', error instanceof Error ? error.message : error);
  }
}

type AimSubjectRow = {
  id: string;
  name: string;
  about: string | null;
  subject_id: string | null;
  list_source: string | null;
  field_id: string | null;
  domain_id: string | null;
  placement_confidence: string | null;
  placement_basis: string | null;
  placement_model: string | null;
  placed_at: string | null;
};

/**
 * Point the goal at its subject, when it points at none. Returns the subject's
 * id, or null for a goal that has no subject to point at (the Level 3 list).
 * The goal's placement is copied to a subject that has none, so a subject made
 * here sits where the goal does.
 */
export async function linkAimSubject(
  supabase: LearnSupabaseClient,
  userId: string,
  aimId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('aims')
    .select(
      'id, name, about, subject_id, list_source, field_id, domain_id, placement_confidence, placement_basis, placement_model, placed_at',
    )
    .eq('id', aimId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`Reading the goal failed: ${error.message}`);
  const aim = data as AimSubjectRow | null;
  if (!aim || aim.list_source) return null;
  if (aim.subject_id) return aim.subject_id;

  const subject = await findOrCreateSubject(supabase, userId, aim.name, { note: aim.about });
  const { data: linked, error: linkError } = await supabase
    .from('aims')
    .update({ subject_id: subject.id })
    .eq('id', aim.id)
    .eq('user_id', userId)
    .is('subject_id', null)
    .select('subject_id');
  if (linkError) throw new Error(`Pointing the goal at its subject failed: ${linkError.message}`);
  if ((linked ?? []).length === 0) {
    // Another save linked it first; keep the subject it took.
    const { data: again } = await supabase.from('aims').select('subject_id').eq('id', aim.id).eq('user_id', userId).maybeSingle();
    return (again as { subject_id: string | null } | null)?.subject_id ?? null;
  }
  if (aim.placed_at) {
    const { error: placeError } = await supabase
      .from('subjects')
      .update({
        field_id: aim.field_id,
        domain_id: aim.domain_id,
        placement_confidence: aim.placement_confidence,
        placement_basis: aim.placement_basis ?? `Placed as the learning goal ${aim.name}.`,
        placement_model: aim.placement_model,
        placed_at: new Date().toISOString(),
      })
      .eq('id', subject.id)
      .eq('user_id', userId)
      .is('placed_at', null);
    if (placeError) console.error('[learn goal saved] placement', placeError.message);
  }
  return subject.id;
}
