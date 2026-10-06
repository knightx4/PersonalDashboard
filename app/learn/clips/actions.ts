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
 * More clips for the queue, leaving out the ones already in it. The queued
 * ones still count against their video's two a week.
 */
// latency: pending
export async function loadMoreClipsAction(queued: string[]): Promise<PlayerClip[]> {
  const { user, learn } = await owner();
  return loadPlayerClips(learn, user.id, {
    excludeIds: queued.filter((id) => UUID.test(id)).slice(0, 200),
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
