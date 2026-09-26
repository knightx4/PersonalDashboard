'use server';

import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/lib/dev/owner';
import { createLearnClient } from '@/lib/learn/auth/server';
import { settleVideoCards } from '@/lib/learn/youtube/video-card-run';
import { fileVideo, isVerdict, setWatched } from '@/lib/learn/youtube/videos';

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

/**
 * Move a video to another pile when the judge got it wrong (plan #1068).
 *
 * Kept as your verdict, which the judge never overwrites and reads back as an
 * example on its next run. The video's cards in Learn now follow at once: an
 * unseen card is set aside when the video leaves the card pile and comes back
 * when it returns. A card never written before waits for the hourly run, since
 * writing one is a model call.
 */
// latency: pending
export async function moveVideoAction(formData: FormData): Promise<void> {
  const user = await requireOwner();
  const videoId = String(formData.get('videoId') ?? '');
  const verdict = formData.get('verdict');
  if (!VIDEO_ID.test(videoId) || !isVerdict(verdict)) return;
  const learn = await createLearnClient();
  await fileVideo(learn, user.id, videoId, verdict);
  // The move stands without this; the hourly run settles the cards if it fails.
  await settleVideoCards(learn, user.id).catch((error: unknown) => {
    console.error('[videos] settling cards after a move', error instanceof Error ? error.message : error);
  });
  revalidatePath('/learn/videos', 'layout');
}
