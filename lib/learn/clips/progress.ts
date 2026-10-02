import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { videosToClip, type CameFrom } from '@/lib/learn/youtube/clip-run';
import { nextLibraryRun } from './progress-line';

/**
 * How far cutting has got, for the line on the Videos page.
 *
 * Done is read from learn.video_clip_cuts (a row per video cut, even one that
 * gave no clips); waiting is what the library run would cut next, from the
 * same videosToClip the run uses, so the two cannot disagree about which
 * videos count. Read with the person's client, so RLS keeps it to their own.
 */

export type ClipTally = { cut: number; total: number };

export type ClipProgress = {
  playlist: ClipTally;
  channel: ClipTally;
  clips: number;
  scored: number;
  /** Clips each video gave, by YouTube id, for the videos already cut. */
  perVideo: Map<string, number>;
  nextRunAt: Date;
};

export async function loadClipProgress(
  learn: LearnSupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<ClipProgress> {
  const [cuts, clips, waiting] = await Promise.all([
    learn.from('video_clip_cuts').select('video_id, came_from, clip_count').eq('user_id', userId),
    learn.from('video_clips').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    videosToClip(learn, userId),
  ]);
  if (cuts.error) throw new Error(`Could not read clip cuts: ${cuts.error.message}`);
  if (clips.error) throw new Error(`Could not count clips: ${clips.error.message}`);
  const scored = await learn
    .from('video_clips')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .not('score', 'is', null);
  if (scored.error) throw new Error(`Could not count scored clips: ${scored.error.message}`);

  const tally = (from: CameFrom): ClipTally => {
    const cut = (cuts.data ?? []).filter((row) => row.came_from === from).length;
    const left = waiting.filter((video) => video.userId === userId && video.cameFrom === from).length;
    return { cut, total: cut + left };
  };
  const perVideo = new Map<string, number>();
  for (const row of cuts.data ?? []) perVideo.set(row.video_id, row.clip_count ?? 0);

  return {
    playlist: tally('playlist'),
    channel: tally('channel'),
    clips: clips.count ?? 0,
    scored: scored.count ?? 0,
    perVideo,
    nextRunAt: nextLibraryRun(now),
  };
}
