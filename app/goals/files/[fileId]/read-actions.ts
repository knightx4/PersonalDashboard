'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { markFileRead } from '@/lib/files/store';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { markStepsRead } from '@/lib/goals/files-store';

const Id = z.string().uuid();
const Ids = z.array(z.string().uuid()).max(50);

/**
 * Opening a file marks it read (core.files.read_at, plan #1861), so the goal
 * page, the Files list and the Goals home stop counting it, and marks read the
 * Dash results that link to it (note be1ed0d3). Fired once when the page
 * mounts rather than while it renders, so a prefetch of the link does not
 * count as reading.
 */
// latency: instant -- nothing on the file page changes; the goal page redraws next time it is opened
export async function markFileReadAction(fileId: string, stepIds: string[]): Promise<void> {
  await requireUser();
  const file = Id.safeParse(fileId);
  if (!file.success) return;
  const ids = Ids.safeParse(stepIds);
  const [fileMarked, stepsMarked] = await Promise.all([
    createCoreClient()
      .then((core) => markFileRead(core, file.data))
      .catch(() => false),
    ids.success && ids.data.length > 0
      ? createGoalsClient()
          .then((goals) => markStepsRead(goals, ids.data))
          .catch(() => 0)
      : 0,
  ]);
  if (fileMarked || stepsMarked > 0) revalidatePath('/goals', 'layout');
}
