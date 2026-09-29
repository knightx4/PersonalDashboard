import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { watchUrl, type YouTubeVideo } from '@/lib/learn/providers/youtube';
import type { Pick, Sample } from './channel-judge';
import { cutStoredTranscript } from './transcripts';
import { catalogueItems, storeNewVideos } from './watch-list';

/**
 * Keeping the good videos a channel was judged on (plan #1197, under #1185).
 *
 * Each sample the video judge filed under watch or card becomes a
 * learn.watch_list row with came_from 'channel search' and the subject it was
 * found for, carrying the verdict, line, best stretch and stretches the judge
 * already wrote, so nothing is judged twice. From there it is a video like
 * any from the playlist: the Videos section lists it, the card run (#1067)
 * turns a card one into Learn now cards, and the summary pass reads it.
 *
 * The video needs a catalogue row of kind video for the transcript to be cut
 * into segments and embedded. One already in the catalogue is linked as it
 * is; a new one is stored the way the playlist stores a video from a channel
 * Learn does not follow. Its transcript was fetched before the row existed,
 * so it is cut here from the stored copy.
 *
 * A video already on the list is left as it is: what the person or the
 * playlist judge decided about it stands. Skipped samples stay on the
 * channel row only.
 */

export type KeptSample = Sample & { verdict: 'watch' | 'card' };

/** The samples worth keeping. */
export function samplesToKeep(samples: readonly Sample[]): KeptSample[] {
  return samples.filter((sample): sample is KeptSample => sample.verdict === 'watch' || sample.verdict === 'card');
}

/** The watch_list row a kept sample becomes. */
export function keptRow(input: { userId: string; subjectId: string; itemId: string; sample: KeptSample; at: string }) {
  const { sample, at } = input;
  return {
    user_id: input.userId,
    video_id: sample.video_id,
    item_id: input.itemId,
    came_from: 'channel search' as const,
    subject_id: input.subjectId,
    added_at: at,
    verdict: sample.verdict,
    judge_verdict: sample.verdict,
    verdict_by: 'judge' as const,
    why: sample.line,
    judged_from: sample.judged_from,
    best_start_seconds: sample.best_start_seconds,
    best_end_seconds: sample.best_end_seconds,
    stretches: sample.stretches,
    screened_at: at,
    judged_at: at,
    updated_at: at,
  };
}

/** A pick as the catalogue stores a video, under the channel it came from. */
function pickVideo(pick: Pick | undefined, sample: Sample, channel: { id: string; title: string }): YouTubeVideo {
  return {
    videoId: sample.video_id,
    title: pick?.title ?? sample.title,
    description: pick?.description ?? '',
    canonicalUrl: watchUrl(sample.video_id),
    durationSeconds: pick?.duration_seconds ?? null,
    publishedAt: null,
    channelId: channel.id,
    channelTitle: channel.title,
  };
}

/**
 * Put the watch and card samples in the person's Videos section. Returns how
 * many went on the list; a video already there counts as not added.
 */
export async function keepGoodSamples(
  learn: LearnSupabaseClient,
  input: {
    userId: string;
    subjectId: string;
    channel: { youtube_channel_id: string; title: string };
    picks: readonly Pick[];
    samples: readonly Sample[];
    now?: Date;
  },
): Promise<number> {
  const keep = samplesToKeep(input.samples);
  if (keep.length === 0) return 0;
  const ids = keep.map((sample) => sample.video_id);

  const items = await catalogueItems(learn, ids);
  const missing = keep.filter((sample) => !items.has(sample.video_id));
  if (missing.length > 0) {
    const channel = { id: input.channel.youtube_channel_id, title: input.channel.title };
    const videos = missing.map((sample) =>
      pickVideo(
        input.picks.find((pick) => pick.video_id === sample.video_id),
        sample,
        channel,
      ),
    );
    for (const [videoId, itemId] of await storeNewVideos(learn, videos)) items.set(videoId, itemId);
  }

  const at = (input.now ?? new Date()).toISOString();
  const rows = keep.flatMap((sample) => {
    const itemId = items.get(sample.video_id);
    return itemId ? [keptRow({ userId: input.userId, subjectId: input.subjectId, itemId, sample, at })] : [];
  });
  const { data, error } = await learn
    .from('watch_list')
    .upsert(rows, { onConflict: 'user_id,video_id', ignoreDuplicates: true })
    .select('video_id');
  if (error) throw new Error(`Keeping ${input.channel.title}'s videos failed: ${error.message}`);

  for (const sample of keep) await cutStoredTranscript(learn, sample.video_id);
  return (data ?? []).length;
}
