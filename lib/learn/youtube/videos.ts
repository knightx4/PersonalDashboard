import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { chaptersFromDescription, type YouTubeChapter } from '@/lib/learn/providers/youtube';
import type { TranscriptState } from './transcripts';
import { readStretches } from './video-cards';

/**
 * What the Videos section reads: your list (learn.watch_list), not the
 * catalogue's thousands of channel videos (plan #1069).
 *
 * Read through the signed-in client. watch_list rows are the person's own by
 * RLS; the catalogue rows and transcript states they join to are readable by
 * any signed-in account (0022, 0042).
 *
 * The list is one playlist's worth, a few hundred rows at most, so it is read
 * whole and narrowed here: `filterVideos` is the one place a search or a
 * verdict filter (#1068) narrows it.
 */

export type Verdict = 'watch' | 'card' | 'skip';

export type ListVideo = {
  videoId: string;
  title: string;
  channel: string | null;
  durationSeconds: number | null;
  addedAt: string;
  watchedAt: string | null;
  /** Set by the judge (#1066) or by moving it by hand (#1068). */
  verdict: Verdict | null;
  /** Who filed it under `verdict`: the judge, or you on the Videos page. */
  verdictBy: 'judge' | 'you' | null;
  /** What the judge said, which is where a video you moved came from. */
  judgeVerdict: Verdict | null;
  /** The judge's reason. Kept after a move, as what you disagreed with. */
  why: string | null;
  bestStartSeconds: number | null;
  bestEndSeconds: number | null;
  /** Set once the first pass has read it; with no verdict, it is waiting on its transcript. */
  screenedAt: string | null;
  /** Stretches the judge named: what a card-pile video's cards are written from (#1067). */
  stretchCount: number;
  /** The subject a channel search found it for (#1197); null for a video you added. */
  foundFor: string | null;
};

type ProviderJoin = { name: string; youtube_channel_id: string | null } | { name: string; youtube_channel_id: string | null }[] | null;

type ItemJoin = {
  id: string;
  title: string;
  author: string | null;
  description: string | null;
  duration_seconds: number | null;
  canonical_url: string;
  provider: ProviderJoin;
};

type ListRow = {
  video_id: string;
  added_at: string;
  watched_at: string | null;
  verdict: Verdict | null;
  verdict_by: 'judge' | 'you' | null;
  judge_verdict: Verdict | null;
  why: string | null;
  best_start_seconds: number | null;
  best_end_seconds: number | null;
  screened_at: string | null;
  stretches: unknown;
  item: ItemJoin | ItemJoin[] | null;
  subject: { name: string } | { name: string }[] | null;
};

const one = <T>(value: T | T[] | null): T | null => (Array.isArray(value) ? (value[0] ?? null) : value);

/**
 * The channel's name: the author under the youtube-list provider, which holds
 * videos from channels Learn does not follow, and the provider's own name for
 * a channel it does.
 */
function channelOf(item: ItemJoin): string | null {
  return item.author ?? one(item.provider)?.name ?? null;
}

const LIST_COLUMNS =
  'video_id, added_at, watched_at, verdict, verdict_by, judge_verdict, why, best_start_seconds, best_end_seconds, screened_at, stretches, subject:subjects!watch_list_subject_id_fkey(name), item:catalogue_items!watch_list_item_id_fkey(id, title, author, description, duration_seconds, canonical_url, provider:catalogue_providers!catalogue_items_provider_id_fkey(name, youtube_channel_id))';

function toListVideo(row: ListRow): ListVideo | null {
  const item = one(row.item);
  if (!item) return null;
  return {
    videoId: row.video_id,
    title: item.title,
    channel: channelOf(item),
    durationSeconds: item.duration_seconds,
    addedAt: row.added_at,
    watchedAt: row.watched_at,
    verdict: row.verdict,
    verdictBy: row.verdict ? row.verdict_by : null,
    judgeVerdict: row.judge_verdict,
    why: row.why,
    bestStartSeconds: row.best_start_seconds,
    bestEndSeconds: row.best_end_seconds,
    screenedAt: row.screened_at,
    stretchCount: readStretches(row.stretches).length,
    foundFor: one(row.subject)?.name ?? null,
  };
}

/** Every video on your list and still on the playlist, newest added first. */
export async function loadListVideos(learn: LearnSupabaseClient, userId: string): Promise<ListVideo[]> {
  const { data, error } = await learn
    .from('watch_list')
    .select(LIST_COLUMNS)
    .eq('user_id', userId)
    .is('left_playlist_at', null)
    .order('added_at', { ascending: false });
  if (error) throw new Error(`Reading your videos failed: ${error.message}`);
  return ((data ?? []) as unknown as ListRow[]).map(toListVideo).filter((video): video is ListVideo => video !== null);
}

export type VideoFilter = {
  /** Words that must all appear in the title or the channel's name. */
  q?: string | null;
  /** Only videos in this pile (#1068), or the ones the judge has not settled. */
  verdict?: Pile | null;
};

/** A pile on the Videos page: a verdict, or not judged yet. */
export type Pile = Verdict | 'unjudged';

export function isPile(value: unknown): value is Pile {
  return value === 'unjudged' || isVerdict(value);
}

export const VERDICTS: readonly Verdict[] = ['watch', 'card', 'skip'];

export function isVerdict(value: unknown): value is Verdict {
  return typeof value === 'string' && (VERDICTS as readonly string[]).includes(value);
}

/** How many videos are in each pile, and how many the judge has not settled. */
export function pileCounts(videos: readonly ListVideo[]): Record<Pile, number> {
  const counts = { watch: 0, card: 0, skip: 0, unjudged: 0 };
  for (const video of videos) counts[video.verdict ?? 'unjudged'] += 1;
  return counts;
}

export const PILE_LABEL: Record<Pile, string> = { watch: 'Watch', card: 'Card', skip: 'Skip', unjudged: 'Not judged' };

/**
 * Where a video opens: at its best minute for one in the Watch pile, so the
 * player starts on the stretch the judge found worth your time.
 */
export function videoHref(video: Pick<ListVideo, 'videoId' | 'verdict' | 'bestStartSeconds'>): string {
  const base = `/learn/videos/${video.videoId}`;
  return video.verdict === 'watch' && video.bestStartSeconds !== null ? `${base}?t=${video.bestStartSeconds}` : base;
}

/**
 * The line under a video saying why it is in its pile.
 *
 * The judge's reason as it stands; for a video you moved, whose reason was
 * written for the pile it came from, that it was yours and what the judge
 * had said. A video with no verdict says what it is waiting for.
 */
export function verdictReason(
  video: Pick<ListVideo, 'verdict' | 'verdictBy' | 'judgeVerdict' | 'why' | 'screenedAt'>,
): string {
  if (!video.verdict) {
    return video.screenedAt
      ? `Not judged yet: it passed the first look and waits on its transcript.${video.why ? ` ${video.why}` : ''}`
      : 'Not judged yet. The next library run reads it.';
  }
  if (video.verdictBy === 'you') {
    if (!video.judgeVerdict) return 'Filed by you before the judge read it.';
    if (video.judgeVerdict === video.verdict) return `Filed by you, where the judge put it too.${video.why ? ` ${video.why}` : ''}`;
    return `You moved this from ${PILE_LABEL[video.judgeVerdict].toLowerCase()}. The judge had said: ${video.why ?? 'no reason given.'}`;
  }
  return video.why ?? 'The judge gave no reason.';
}

/** The list narrowed by a search and a verdict. Order is kept. */
export function filterVideos(videos: readonly ListVideo[], filter: VideoFilter): ListVideo[] {
  const words = (filter.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return videos.filter((video) => {
    if (filter.verdict && (video.verdict ?? 'unjudged') !== filter.verdict) return false;
    if (words.length === 0) return true;
    const haystack = `${video.title} ${video.channel ?? ''}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

export type ListVideoPage = ListVideo & {
  itemId: string;
  url: string;
  description: string | null;
  chapters: YouTubeChapter[];
  summary: string | null;
  keyPoints: string[];
  summaryFrom: 'description' | 'transcript' | null;
  summarisedAt: string | null;
  transcriptState: TranscriptState | null;
  leftPlaylistAt: string | null;
};

/** One video on your list, with its summary. Null when it is not on your list. */
export async function loadListVideo(
  learn: LearnSupabaseClient,
  userId: string,
  videoId: string,
): Promise<ListVideoPage | null> {
  const { data, error } = await learn
    .from('watch_list')
    .select(`${LIST_COLUMNS}, left_playlist_at, summary, key_points, summary_from, summarised_at`)
    .eq('user_id', userId)
    .eq('video_id', videoId)
    .maybeSingle();
  if (error) throw new Error(`Reading the video failed: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as ListRow & {
    left_playlist_at: string | null;
    summary: string | null;
    key_points: string[] | null;
    summary_from: 'description' | 'transcript' | null;
    summarised_at: string | null;
  };
  const video = toListVideo(row);
  const item = one(row.item);
  if (!video || !item) return null;

  const transcript = await learn.from('video_transcripts').select('state').eq('video_id', videoId).maybeSingle();
  if (transcript.error) throw new Error(`Reading the transcript state failed: ${transcript.error.message}`);

  return {
    ...video,
    itemId: item.id,
    url: item.canonical_url,
    description: item.description,
    chapters: item.description ? chaptersFromDescription(item.description) : [],
    summary: row.summary,
    keyPoints: row.key_points ?? [],
    summaryFrom: row.summary_from,
    summarisedAt: row.summarised_at,
    transcriptState: (transcript.data as { state: TranscriptState } | null)?.state ?? null,
    leftPlaylistAt: row.left_playlist_at,
  };
}

/** Mark a video on your list watched, or not. RLS keeps it to your own row. */
export async function setWatched(
  learn: LearnSupabaseClient,
  userId: string,
  videoId: string,
  watched: boolean,
  now: Date = new Date(),
): Promise<void> {
  const { error } = await learn
    .from('watch_list')
    .update({ watched_at: watched ? now.toISOString() : null, updated_at: now.toISOString() })
    .eq('user_id', userId)
    .eq('video_id', videoId);
  if (error) throw new Error(`Marking the video failed: ${error.message}`);
}

/**
 * File a video under another pile yourself (#1068).
 *
 * Sets the verdict and marks it yours, which the judge never overwrites
 * (judging.ts guards every write on verdict_by) and reads back as an example
 * on its next run. The judge's reason, its best stretch and its stretches are
 * left as they were: the page shows the reason as what you disagreed with, a
 * video moved from watch to card keeps the stretches its cards are written
 * from, and one moved back keeps its best minute.
 */
export async function fileVideo(
  learn: LearnSupabaseClient,
  userId: string,
  videoId: string,
  verdict: Verdict,
  now: Date = new Date(),
): Promise<void> {
  const stamp = now.toISOString();
  const { error } = await learn
    .from('watch_list')
    .update({ verdict, verdict_by: 'you', judged_at: stamp, updated_at: stamp })
    .eq('user_id', userId)
    .eq('video_id', videoId);
  if (error) throw new Error(`Moving the video failed: ${error.message}`);
}

/** A Learn now card a video became (#1067), as the Videos section lists it. */
export type VideoCard = {
  id: string;
  videoId: string;
  startSeconds: number;
  endSeconds: number | null;
  /** The idea the card was written about, or the stretch's point before it is written. */
  title: string;
  conceptId: string | null;
  status: string;
};


/**
 * The cards your videos became, by video, in the order they play. Pass the
 * ids to read one video's; leave them out for the whole list.
 */
export async function loadVideoCards(
  learn: LearnSupabaseClient,
  userId: string,
  videoIds?: readonly string[],
): Promise<Map<string, VideoCard[]>> {
  let query = learn
    .from('feed_cards')
    .select('id, video_id, video_start_seconds, video_end_seconds, idea_name, pick_basis, concept_id, status')
    .eq('user_id', userId)
    .eq('reason', 'video')
    // Cards that are out, or were: not ones still being written, nor set aside.
    .not('status', 'in', '(picked,dropped)');
  if (videoIds) query = query.in('video_id', [...videoIds]);
  const { data, error } = await query.order('video_start_seconds');
  if (error) throw new Error(`Reading the cards your videos became failed: ${error.message}`);
  const out = new Map<string, VideoCard[]>();
  type Row = {
    id: string;
    video_id: string;
    video_start_seconds: number;
    video_end_seconds: number | null;
    idea_name: string | null;
    pick_basis: string | null;
    concept_id: string | null;
    status: string;
  };
  for (const row of (data ?? []) as Row[]) {
    const card: VideoCard = {
      id: row.id,
      videoId: row.video_id,
      startSeconds: row.video_start_seconds,
      endSeconds: row.video_end_seconds,
      title: row.idea_name?.trim() || row.pick_basis?.trim() || 'A card from this video',
      conceptId: row.concept_id,
      status: row.status,
    };
    out.set(row.video_id, [...(out.get(row.video_id) ?? []), card]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// What in Learn a video is closest to.
// ---------------------------------------------------------------------------

/** The most segments searched from, so a three-hour lecture is not 200 queries. */
const MAX_SEGMENTS = 24;
/** How close an idea has to be. The same bar the library uses to pick videos for your ideas (match.ts). */
export const RELATED_MIN_SIMILARITY = 0.5;
export const RELATED_LIMIT = 3;

export type NearIdea = { conceptId: string; name: string; similarity: number };

export type RelatedIdea = NearIdea & { subjectId: string | null; subjectName: string | null };

/**
 * The ideas closest to any part of the video, best first, each once.
 *
 * Each segment is its own query and an idea keeps its best score across them,
 * so a video that spends ten minutes on one of your ideas finds it even when
 * the rest of the video is about something else.
 */
export function closestIdeas(perSegment: readonly (readonly NearIdea[])[], limit: number = RELATED_LIMIT): NearIdea[] {
  const best = new Map<string, NearIdea>();
  for (const found of perSegment) {
    for (const idea of found) {
      const seen = best.get(idea.conceptId);
      if (!seen || idea.similarity > seen.similarity) best.set(idea.conceptId, idea);
    }
  }
  return [...best.values()].sort((a, b) => b.similarity - a.similarity || a.name.localeCompare(b.name)).slice(0, limit);
}

/**
 * Up to three of your ideas the video is nearest, with the track each is in.
 *
 * Searched from the video's embedded segments with nearest_concepts (learn
 * migration 0052). A video with no segments yet, which is every video whose
 * transcript has not been fetched, is searched from its title-and-description
 * vector instead, which the library run makes for every listed video.
 */
export async function loadRelatedIdeas(learn: LearnSupabaseClient, userId: string, itemId: string): Promise<RelatedIdea[]> {
  const segments = await learn
    .from('catalogue_segments')
    .select('embedding')
    .eq('item_id', itemId)
    .not('embedding', 'is', null)
    .order('ordinal')
    .limit(MAX_SEGMENTS);
  if (segments.error) throw new Error(`Reading the video's segments failed: ${segments.error.message}`);
  let vectors = ((segments.data ?? []) as { embedding: string | null }[]).map((row) => row.embedding).filter((v): v is string => !!v);

  if (vectors.length === 0) {
    const item = await learn.from('catalogue_items').select('metadata_embedding').eq('id', itemId).maybeSingle();
    if (item.error) throw new Error(`Reading the video failed: ${item.error.message}`);
    const vector = (item.data as { metadata_embedding: string | null } | null)?.metadata_embedding;
    vectors = vector ? [vector] : [];
  }
  if (vectors.length === 0) return [];

  const perSegment = await Promise.all(
    vectors.map(async (vector) => {
      const { data, error } = await learn.rpc('nearest_concepts', {
        for_user: userId,
        query_embedding: vector,
        match_limit: RELATED_LIMIT,
        min_similarity: RELATED_MIN_SIMILARITY,
      });
      if (error) throw new Error(`Finding the ideas near the video failed: ${error.message}`);
      return ((data ?? []) as { concept_id: string; name: string; similarity: number }[]).map((row) => ({
        conceptId: row.concept_id,
        name: row.name,
        similarity: row.similarity,
      }));
    }),
  );
  const ideas = closestIdeas(perSegment);
  if (ideas.length === 0) return [];

  const concepts = await learn
    .from('concepts')
    .select('id, subject:subjects!concepts_subject_fk(id, name)')
    .eq('user_id', userId)
    .in('id', ideas.map((idea) => idea.conceptId));
  if (concepts.error) throw new Error(`Reading the ideas' subjects failed: ${concepts.error.message}`);
  const subjects = new Map(
    ((concepts.data ?? []) as unknown as { id: string; subject: { id: string; name: string } | { id: string; name: string }[] | null }[]).map(
      (row) => [row.id, one(row.subject)],
    ),
  );
  return ideas.map((idea) => {
    const subject = subjects.get(idea.conceptId) ?? null;
    return { ...idea, subjectId: subject?.id ?? null, subjectName: subject?.name ?? null };
  });
}
