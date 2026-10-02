import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { pickNextClips, SKIP_RETURN_MS, type ClipReaction, type RankableClip } from './rank';

/**
 * The next clips for the stream (plan #1399).
 *
 * Reads the person's clips and what they did with earlier ones, and hands
 * both to pickNextClips (rank.ts), which holds every rule about order. Takes
 * the person's own client, so RLS scopes every read; the user_id filter is
 * there for the index.
 *
 * The player (#1400) calls this for a handful at a time, passing when the
 * session started so the two-a-video cap holds across calls, and the ids it
 * has queued but not yet shown.
 */

/** Candidates read per source. The best of each by score, so a playlist clip is never crowded out by channel clips. */
const CANDIDATES = 200;
/** Clips skipped long enough ago to come back, read to fill in after the unseen ones. */
const RETURNING = 50;
/** Past reactions read for the channel and theme lean, newest first. */
const REACTIONS = 500;
const REACTION_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
/** A Learn now card this recent lifts clips of its track. */
const RECENT_CARD_MS = 3 * 24 * 60 * 60 * 1000;

const CLIP_COLUMNS =
  'id, video_id, item_id, came_from, start_seconds, end_seconds, caption, idea, serves, subject_id, goal_id, ' +
  'score, shown_at, skipped_at, not_interested_at, saved_at, ' +
  'item:catalogue_items!video_clips_item_id_fkey(title, author)';

/** A clip ready to play. */
export type StreamClip = RankableClip & {
  itemId: string | null;
  startSeconds: number;
  endSeconds: number;
  caption: string;
  idea: string | null;
  serves: string | null;
  subjectId: string | null;
  goalId: string | null;
  /** The video's title, from the catalogue; null if the catalogue row is gone. */
  title: string | null;
  savedAt: string | null;
};

export type NextClipsOptions = {
  /** How many to return. Default 5. */
  limit?: number;
  /** When this viewing session started (ISO). Clips shown since count against two-a-video. */
  sessionStartedAt?: string | null;
  /** Clips already queued on the phone, left out. */
  excludeIds?: readonly string[];
  /** Milliseconds since the epoch; for tests. */
  now?: number;
};

type ItemEmbed = { title: string | null; author: string | null } | null;

type ClipRow = {
  id: string;
  video_id: string;
  item_id: string | null;
  came_from: 'playlist' | 'channel';
  start_seconds: number;
  end_seconds: number;
  caption: string;
  idea: string | null;
  serves: string | null;
  subject_id: string | null;
  goal_id: string | null;
  score: number | null;
  shown_at: string | null;
  skipped_at: string | null;
  not_interested_at: string | null;
  saved_at: string | null;
  item: ItemEmbed | ItemEmbed[];
};

type ReactionRow = {
  subject_id: string | null;
  serves: string | null;
  shown_at: string | null;
  watched_seconds: number | null;
  skipped_at: string | null;
  finished_at: string | null;
  saved_at: string | null;
  item: ClipRow['item'];
};

function embedded(item: ClipRow['item']): ItemEmbed {
  return Array.isArray(item) ? (item[0] ?? null) : item;
}

/** What identifies a channel: the catalogue item's author, trimmed and lower-cased so spellings agree. */
export function channelKey(author: string | null | undefined): string | null {
  const key = author?.trim().toLowerCase();
  return key ? key : null;
}

/** What identifies a theme: the track id, or else the name the cutter wrote. */
export function themeKey(subjectId: string | null, serves: string | null): string | null {
  if (subjectId) return `track:${subjectId}`;
  const name = serves?.trim().toLowerCase();
  return name ? `serves:${name}` : null;
}

function toClip(row: ClipRow): StreamClip {
  const item = embedded(row.item);
  return {
    id: row.id,
    videoId: row.video_id,
    itemId: row.item_id,
    cameFrom: row.came_from,
    score: row.score,
    channel: channelKey(item?.author),
    theme: themeKey(row.subject_id, row.serves),
    shownAt: row.shown_at,
    skippedAt: row.skipped_at,
    notInterestedAt: row.not_interested_at,
    savedAt: row.saved_at,
    startSeconds: row.start_seconds,
    endSeconds: row.end_seconds,
    caption: row.caption,
    idea: row.idea,
    serves: row.serves,
    subjectId: row.subject_id,
    goalId: row.goal_id,
    title: item?.title ?? null,
  };
}

function fail(what: string, error: { message: string } | null): void {
  if (error) throw new Error(`${what} failed: ${error.message}`);
}

export async function loadNextClips(
  learn: LearnSupabaseClient,
  userId: string,
  options: NextClipsOptions = {},
): Promise<StreamClip[]> {
  const now = options.now ?? Date.now();
  const returnBefore = new Date(now - SKIP_RETURN_MS).toISOString();

  const unseen = (cameFrom: 'playlist' | 'channel') =>
    learn
      .from('video_clips')
      .select(CLIP_COLUMNS)
      .eq('user_id', userId)
      .eq('came_from', cameFrom)
      .is('shown_at', null)
      .is('not_interested_at', null)
      .order('score', { ascending: false, nullsFirst: false })
      .limit(CANDIDATES);

  const [playlist, channel, returning, reactions, session, cards] = await Promise.all([
    unseen('playlist'),
    unseen('channel'),
    learn
      .from('video_clips')
      .select(CLIP_COLUMNS)
      .eq('user_id', userId)
      .is('not_interested_at', null)
      .lt('skipped_at', returnBefore)
      .lt('shown_at', returnBefore)
      .order('score', { ascending: false, nullsFirst: false })
      .limit(RETURNING),
    learn
      .from('video_clips')
      .select(
        'subject_id, serves, shown_at, watched_seconds, skipped_at, finished_at, saved_at, ' +
          'item:catalogue_items!video_clips_item_id_fkey(title, author)',
      )
      .eq('user_id', userId)
      .or('skipped_at.not.is.null,finished_at.not.is.null,saved_at.not.is.null')
      .gte('updated_at', new Date(now - REACTION_WINDOW_MS).toISOString())
      .order('updated_at', { ascending: false })
      .limit(REACTIONS),
    options.sessionStartedAt
      ? learn
          .from('video_clips')
          .select('video_id')
          .eq('user_id', userId)
          .gte('shown_at', options.sessionStartedAt)
      : Promise.resolve({ data: [], error: null }),
    learn
      .from('feed_cards')
      .select('subject_id')
      .eq('user_id', userId)
      .not('subject_id', 'is', null)
      .gte('created_at', new Date(now - RECENT_CARD_MS).toISOString())
      .limit(100),
  ]);
  fail('Reading your playlist clips', playlist.error);
  fail('Reading your channel clips', channel.error);
  fail('Reading clips to bring back', returning.error);
  fail('Reading what you did with earlier clips', reactions.error);
  fail('Reading this session', session.error);
  fail('Reading your recent Learn now cards', cards.error);

  const clips = [
    ...((playlist.data ?? []) as unknown as ClipRow[]),
    ...((channel.data ?? []) as unknown as ClipRow[]),
    ...((returning.data ?? []) as unknown as ClipRow[]),
  ].map(toClip);

  const reactionRows = (reactions.data ?? []) as unknown as ReactionRow[];
  const past: ClipReaction[] = reactionRows.map((row) => ({
    channel: channelKey(embedded(row.item)?.author),
    theme: themeKey(row.subject_id, row.serves),
    shownAt: row.shown_at,
    watchedSeconds: row.watched_seconds,
    skippedAt: row.skipped_at,
    finishedAt: row.finished_at,
    savedAt: row.saved_at,
  }));

  const played = new Map<string, number>();
  for (const row of (session.data ?? []) as { video_id: string }[]) {
    played.set(row.video_id, (played.get(row.video_id) ?? 0) + 1);
  }
  const recentThemes = new Set(
    ((cards.data ?? []) as { subject_id: string }[]).map((row) => themeKey(row.subject_id, null) as string),
  );

  return pickNextClips(clips, {
    limit: options.limit ?? 5,
    now,
    reactions: past,
    recentThemes,
    playedThisSession: played,
    excludeIds: new Set(options.excludeIds ?? []),
  });
}
