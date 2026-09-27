'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { markStepsRead } from '@/lib/goals/files-store';

const Ids = z.array(z.string().uuid()).max(50);

/**
 * Opening a file marks read the Dash results that link to it (note
 * be1ed0d3), so the goal page stops listing them as to read. Fired once when
 * the page mounts rather than while it renders, so a prefetch of the link
 * does not count as reading.
 */
// latency: instant -- nothing on the file page changes; the goal page redraws next time it is opened
export async function markFileReadAction(stepIds: string[]): Promise<void> {
  await requireUser();
  const ids = Ids.safeParse(stepIds);
  if (!ids.success || ids.data.length === 0) return;
  const marked = await markStepsRead(await createGoalsClient(), ids.data).catch(() => 0);
  if (marked > 0) revalidatePath('/goals', 'layout');
}
