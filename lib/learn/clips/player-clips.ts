import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { loadNextClips, type NextClipsOptions, type StreamClip } from './next';
import type { PlayerClip } from './stream';

/**
 * The next clips as the player needs them (plan #1400): what loadNextClips
 * picks, with the channel spelled the way YouTube spells it. The picker keys
 * channels lower-cased, which is right for comparing and wrong for showing.
 */

type ItemRow = {
  id: string;
  title: string | null;
  author: string | null;
  provider: { name: string | null } | { name: string | null }[] | null;
};

async function displayNames(learn: LearnSupabaseClient, clips: StreamClip[]): Promise<Map<string, ItemRow>> {
  const ids = [...new Set(clips.flatMap((clip) => (clip.itemId ? [clip.itemId] : [])))];
  if (ids.length === 0) return new Map();
  const { data, error } = await learn
    .from('catalogue_items')
    .select('id, title, author, provider:catalogue_providers!catalogue_items_provider_id_fkey(name)')
    .in('id', ids);
  // The names are for display; a clip still plays without them.
  if (error) {
    console.error('[clips] reading channel names', error.message);
    return new Map();
  }
  return new Map(((data ?? []) as unknown as ItemRow[]).map((row) => [row.id, row]));
}

export function toPlayerClip(clip: StreamClip, item: ItemRow | undefined): PlayerClip {
  const provider = Array.isArray(item?.provider) ? item?.provider[0] : item?.provider;
  return {
    id: clip.id,
    videoId: clip.videoId,
    startSeconds: clip.startSeconds,
    endSeconds: clip.endSeconds,
    caption: clip.caption,
    title: item?.title ?? clip.title,
    channel: item?.author?.trim() || provider?.name?.trim() || null,
    saved: clip.savedAt !== null,
  };
}

export async function loadPlayerClips(
  learn: LearnSupabaseClient,
  userId: string,
  options: NextClipsOptions = {},
): Promise<PlayerClip[]> {
  const clips = await loadNextClips(learn, userId, options);
  const items = await displayNames(learn, clips);
  return clips.map((clip) => toPlayerClip(clip, clip.itemId ? items.get(clip.itemId) : undefined));
}
