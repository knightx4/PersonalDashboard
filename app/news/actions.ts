'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createNewsClient } from '@/lib/news/auth/server';

const MuteInput = z.object({ senderId: z.string().uuid(), muted: z.enum(['true', 'false']) });

/**
 * Quiet a newsletter, or bring it back.
 *
 * A muted sender's issues leave the default list and nothing is deleted: they
 * are still there under that sender's own name in the column, and the sender
 * can be unmuted from the same button. Which row is touched is the policies'
 * decision, not this function's -- the session client only ever sees your own
 * senders, so an id from the form can do nothing but fail.
 */
// latency: pending
export async function setSenderMuted(formData: FormData): Promise<void> {
  const parsed = MuteInput.safeParse({
    senderId: formData.get('senderId'),
    muted: formData.get('muted'),
  });
  if (!parsed.success) return;

  const client = await createNewsClient();
  const { error } = await client
    .from('senders')
    .update({ muted: parsed.data.muted === 'true' })
    .eq('id', parsed.data.senderId);
  if (error) throw new Error(`news: muting that sender failed (${error.message})`);

  revalidatePath('/news');
}
