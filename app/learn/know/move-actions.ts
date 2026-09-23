'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { parseTarget, placementUpdate } from '@/lib/learn/areas/move';

/**
 * Moving a vault theme to another place on the areas grid (plan #797).
 *
 * An update on `learn.theme_fields` through the signed-in client, which the
 * owner's `theme_fields_update` policy allows. A move sets `moved_by_hand`;
 * the hourly placement pass only ever inserts rows for themes that have
 * none, so a row moved here is never written over. The undo in the toast
 * calls this same action with the old place and the old flag.
 */

export type MoveState = { error?: string };

// latency: pending
export async function moveTheme(_prev: MoveState, formData: FormData): Promise<MoveState> {
  await requireUser();

  const parsed = z
    .object({
      placementId: z.string().uuid(),
      to: z.string(),
      byHand: z.enum(['true', 'false']),
    })
    .safeParse({
      placementId: formData.get('placementId'),
      to: formData.get('to'),
      byHand: formData.get('byHand') ?? 'true',
    });
  if (!parsed.success) return { error: 'Choose where to move it.' };

  const target = parseTarget(parsed.data.to);
  if (!target) return { error: 'Choose where to move it.' };

  const learn = await createLearnClient();
  const { data, error } = await learn
    .from('theme_fields')
    .update(placementUpdate(target, parsed.data.byHand === 'true'))
    .eq('id', parsed.data.placementId)
    .select('id');
  if (error) return { error: `The move was not saved: ${error.message}` };
  // RLS hides another account's row, so an update that matched nothing
  // reads as a theme that is not there rather than as an error.
  if (!data || data.length === 0) return { error: 'That theme is no longer placed here.' };

  revalidatePath('/learn/know');
  return {};
}
