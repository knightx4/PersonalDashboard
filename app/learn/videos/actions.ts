'use server';

import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/lib/dev/owner';
import { createLearnClient } from '@/lib/learn/auth/server';
import { setWatched } from '@/lib/learn/youtube/videos';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * The Watched mark on a video on your list (plan #1069). A plain form action,
 * so the mark can be set before the page's JavaScript has loaded; the row is
 * the person's own by RLS, and the Videos section is the owner's, like the
 * YouTube library it is read from.
 */
// latency: pending
export async function setWatchedAction(formData: FormData): Promise<void> {
  const user = await requireOwner();
  const videoId = String(formData.get('videoId') ?? '');
  if (!VIDEO_ID.test(videoId)) return;
  const learn = await createLearnClient();
  await setWatched(learn, user.id, videoId, formData.get('watched') === '1');
  revalidatePath('/learn/videos', 'layout');
}
