import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { CaptureRowWrite } from '@/lib/capture/file';
import { nextPlanPosition } from '@/lib/plan/position';
import { planScopeOf } from '@/lib/plan/projects';

const Title = z.string().trim().min(1, 'A step needs a name.').max(200);
const Id = z.string().uuid();

/**
 * A feature or a step written from capture (plan #1950.5): the title alone,
 * not started, last among its siblings. Everything else (the description,
 * the done-when, the size) is written on its page once it exists, as a
 * feature's other fields always were.
 *
 * A step goes in its parent's module, whatever it is aimed with; a feature
 * goes in the module it was aimed at, or the app as a whole.
 */
export async function writePlanItem(
  supabase: SupabaseClient,
  userId: string,
  title: string,
  at: { scope: string | null; parentId: string | null },
): Promise<CaptureRowWrite> {
  const name = Title.safeParse(title);
  if (!name.success) return { ok: false, error: name.error.issues[0].message };

  let scope = planScopeOf(at.scope);
  let parentId: string | null = null;
  if (at.parentId) {
    if (!Id.safeParse(at.parentId).success) return { ok: false, error: 'That parent step does not exist.' };
    const { data: parent } = await supabase
      .from('plan_items')
      .select('module')
      .eq('user_id', userId)
      .eq('id', at.parentId)
      .maybeSingle();
    if (!parent) return { ok: false, error: 'That parent step does not exist.' };
    scope = planScopeOf(parent.module);
    parentId = at.parentId;
  }

  const position = await nextPlanPosition(supabase, userId, scope, parentId);
  const { data, error } = await supabase
    .from('plan_items')
    .insert({
      user_id: userId,
      module: scope,
      parent_id: parentId,
      title: name.data,
      status: 'not_started',
      kind: 'build',
      priority: 2,
      position,
    })
    .select('id')
    .single();
  if (error || !data?.id) return { ok: false, error: 'That could not be added to the plan. Try again.' };
  return { ok: true, id: String(data.id) };
}
