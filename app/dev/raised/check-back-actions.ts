'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { requireOwner } from '@/lib/dev/owner';

/**
 * Dropping a check-back from the Dash tab or a feature's Steps tab: you have
 * decided it no longer matters, so no session should come back to it. Closing one with what it
 * found is a session's move (`plan.ts checked`), so there is no button for it.
 */
// latency: pending
export async function dropCheckBack(formData: FormData): Promise<void> {
  await requireOwner();
  const user = await requireUser();
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return;

  const supabase = await createClient();
  await supabase
    .from('check_backs')
    .update({ status: 'dropped', outcome: 'Dropped on the Dash tab.', closed_at: new Date().toISOString() })
    .eq('id', id.data)
    .eq('user_id', user.id)
    .eq('status', 'waiting');
  revalidatePath('/dev/raised');
  // A feature's Steps tab lists its check-backs too.
  revalidatePath('/dev/plan/[number]', 'page');
}
