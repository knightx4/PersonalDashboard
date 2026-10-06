'use server';

import { requireOwner } from '@/lib/dev/owner';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadPlayerClips } from '@/lib/learn/clips/player-clips';
import {
  markClipFinished,
  markClipNotInterested,
  markClipSaved,
  markClipShown,
  markClipSkipped,
} from '@/lib/learn/clips/state';
import type { PlayerClip } from '@/lib/learn/clips/stream';

/**
 * The clip player's writes (plan #1400). Called from the player as a clip
 * plays, never from a form, so each returns rather than revalidating: the
 * page does not re-render around a clip that is playing.
 *
 * The owner's alone, like Videos, since the clips are cut from the owner's
 * YouTube library. Each write goes through the person's own client, so RLS
 * keeps it to their clips.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;

function clipId(value: unknown): string {
  const id = String(value ?? '');
  if (!UUID.test(id)) throw new Error('That is not a clip.');
  return id;
}

function seconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function owner() {
  const user = await requireOwner();
  return { user, learn: await createLearnClient() };
}

/**
 * More clips for the queue, leaving out the ones already in it. `startedAt`
 * is when the page opened, so the two-a-video cap holds across fetches.
 */
// latency: pending
export async function loadMoreClipsAction(startedAt: string, queued: string[]): Promise<PlayerClip[]> {
  const { user, learn } = await owner();
  return loadPlayerClips(learn, user.id, {
    sessionStartedAt: STAMP.test(startedAt) ? startedAt : null,
    // The newest 200, in queue order: the end of the queue is what the ten-clip gap reads.
    excludeIds: queued.filter((id) => UUID.test(id)).slice(-200),
  });
}

/** A clip started playing. */
// latency: optimistic
export async function clipShownAction(id: string): Promise<void> {
  const { learn } = await owner();
  await markClipShown(learn, clipId(id));
}

/** A clip played to its end. */
// latency: optimistic
export async function clipFinishedAction(id: string, watched: number | null): Promise<void> {
  const { learn } = await owner();
  await markClipFinished(learn, clipId(id), seconds(watched));
}

/** Swiped past before its end, with the seconds watched. */
// latency: optimistic
export async function clipSkippedAction(id: string, watched: number | null): Promise<void> {
  const { learn } = await owner();
  await markClipSkipped(learn, clipId(id), seconds(watched));
}

/** Saved, or un-saved with `saved` false. */
// latency: optimistic
export async function clipSavedAction(id: string, saved: boolean): Promise<void> {
  const { learn } = await owner();
  await markClipSaved(learn, clipId(id), saved === true);
}

/** Not interested: the clip never plays again. */
// latency: optimistic
export async function clipNotInterestedAction(id: string): Promise<void> {
  const { learn } = await owner();
  await markClipNotInterested(learn, clipId(id));
}
