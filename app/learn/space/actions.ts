'use server';

import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { saveRecording } from '@/lib/learn/map/recording-store';

const Recording = z.object({
  on: z.boolean(),
  hidden: z.array(z.string().uuid()).max(500),
});

// latency: optimistic -- the page shows the mode at once and this keeps it for the next visit
/** Remember recording mode and the places it hides (plan #1997.9). */
export async function saveRecordingAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = Recording.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'That choice could not be read.' };
  const user = await requireUser();
  try {
    await saveRecording(await createLearnClient(), user.id, {
      on: parsed.data.on,
      hidden: [...new Set(parsed.data.hidden)],
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Saving that failed.' };
  }
}
