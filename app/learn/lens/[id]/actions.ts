'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { setLensTargets } from '@/lib/learn/levels/lens-store';
import { MAX_LEVEL } from '@/lib/learn/levels/model';

/**
 * Setting how far you want to go on each topic of a lens (plan #2138.7). The
 * form sends one `target:<topic id>` field a topic; each is kept between 1
 * and the topic's ceiling, and a topic not on the lens is ignored. Progress
 * is computed on read, so nothing else is written.
 */

export type TargetsState = { error?: string };

const Level = z.coerce.number().int().min(1).max(MAX_LEVEL);

// latency: pending
export async function saveLensTargets(_prev: TargetsState, formData: FormData): Promise<TargetsState> {
  await requireUser();
  const lensId = z.string().uuid().safeParse(formData.get('lensId'));
  if (!lensId.success) return { error: 'Could not work out which lens this was.' };

  const levels = new Map<string, number>();
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('target:')) continue;
    const topicId = z.string().uuid().safeParse(key.slice('target:'.length));
    const level = Level.safeParse(value);
    if (!topicId.success || !level.success) return { error: 'Each target is a level from 1 to 10.' };
    levels.set(topicId.data, level.data);
  }

  const supabase = await createLearnClient();
  try {
    await setLensTargets(supabase, lensId.data, levels);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Saving the targets failed.' };
  }

  revalidatePath(`/learn/lens/${lensId.data}`);
  revalidatePath('/learn/know');
  redirect(`/learn/lens/${lensId.data}`);
}
