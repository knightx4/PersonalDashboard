import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { creditState, monthStart, monthlyAllowance, type CreditState } from './budget';
import type { TranscriptState } from './transcripts';

/**
 * What the YouTube library pages read, through the signed-in client.
 *
 * Every table here is readable by any signed-in account (0022 and 0042), so
 * these reads need no service role. The transcript text is the exception: it
 * is in a private bucket, and inngest/learn/youtube-library.ts reads it.
 */

export type ChannelSummary = {
  id: string;
  slug: string;
  name: string;
  handle: string | null;
  homeUrl: string;
  autoTranscribe: boolean;
  lastListedAt: string | null;
  videos: number;
  playlists: number;
};

async function countItems(learn: LearnSupabaseClient, providerId: string, kind: 'video' | 'course'): Promise<number> {
  const { count, error } = await learn
    .from('catalogue_items')
    .select('id', { count: 'exact', head: true })
    .eq('provider_id', providerId)
    .eq('kind', kind);
  if (error) throw new Error(`Counting ${kind}s failed: ${error.message}`);
  return count ?? 0;
}

type ProviderRow = {
  id: string;
  slug: string;
  name: string;
  home_url: string;
  youtube_handle: string | null;
  auto_transcribe: boolean;
  last_swept_at: string | null;
};

const PROVIDER_COLUMNS = 'id, slug, name, home_url, youtube_handle, auto_transcribe, last_swept_at';

function toSummary(row: ProviderRow, videos: number, playlists: number): ChannelSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    handle: row.youtube_handle,
    homeUrl: row.home_url,
    autoTranscribe: row.auto_transcribe,
    lastListedAt: row.last_swept_at,
    videos,
    playlists,
  };
}

export async function loadChannelSummaries(learn: LearnSupabaseClient): Promise<ChannelSummary[]> {
  const { data, error } = await learn
    .from('catalogue_providers')
    .select(PROVIDER_COLUMNS)
    .not('youtube_channel_id', 'is', null)
    .order('name');
  if (error) throw new Error(`Reading channels failed: ${error.message}`);

  return Promise.all(
    ((data ?? []) as ProviderRow[]).map(async (row) =>
      toSummary(row, await countItems(learn, row.id, 'video'), await countItems(learn, row.id, 'course')),
    ),
  );
}

export type TranscriptCall = {
  calledAt: string;
  videoId: string;
  status: number;
  credits: number;
  outcome: string;
  trigger: string;
  detail: string | null;
};

export type Usage = {
  credits: CreditState;
  /** Calls this month by outcome, charged or not. */
  outcomes: Record<string, number>;
  recent: TranscriptCall[];
  queue: { queued: number; failed: number; none: number; fetched: number };
};

async function countState(learn: LearnSupabaseClient, state: TranscriptState): Promise<number> {
  const { count, error } = await learn
    .from('video_transcripts')
    .select('video_id', { count: 'exact', head: true })
    .eq('state', state);
  if (error) throw new Error(`Counting ${state} transcripts failed: ${error.message}`);
  return count ?? 0;
}

/**
 * The month's credits and the calls behind them.
 *
 * One read of this month's ledger. At the planned rate that is at most a few
 * thousand narrow rows, so the counting is done here rather than in a query
 * per outcome.
 */
export async function loadUsage(learn: LearnSupabaseClient, now: Date = new Date()): Promise<Usage> {
  const { data, error } = await learn
    .from('transcript_calls')
    .select('called_at, video_id, status, credits, outcome, trigger, detail')
    .gte('called_at', monthStart(now).toISOString())
    .order('called_at', { ascending: false })
    .limit(5000);
  if (error) throw new Error(`Reading the transcript ledger failed: ${error.message}`);

  const rows = (data ?? []) as {
    called_at: string;
    video_id: string;
    status: number;
    credits: number;
    outcome: string;
    trigger: string;
    detail: string | null;
  }[];

  const outcomes: Record<string, number> = {};
  let used = 0;
  for (const row of rows) {
    used += row.credits;
    outcomes[row.outcome] = (outcomes[row.outcome] ?? 0) + 1;
  }

  const [queued, failed, none, fetched] = await Promise.all([
    countState(learn, 'queued'),
    countState(learn, 'failed'),
    countState(learn, 'none'),
    countState(learn, 'fetched'),
  ]);

  return {
    credits: creditState(used, monthlyAllowance(), now),
    outcomes,
    recent: rows.slice(0, 12).map((row) => ({
      calledAt: row.called_at,
      videoId: row.video_id,
      status: row.status,
      credits: row.credits,
      outcome: row.outcome,
      trigger: row.trigger,
      detail: row.detail,
    })),
    queue: { queued, failed, none, fetched },
  };
}

export type VideoRow = {
  itemId: string;
  videoId: string;
  title: string;
  url: string;
  publishedAt: string | null;
  durationSeconds: number | null;
  state: TranscriptState | null;
  /** Why it failed or has no transcript, when it did or has not. */
  note: string | null;
};

type ItemRow = {
  id: string;
  external_id: string;
  title: string;
  canonical_url: string;
  published_at: string | null;
  duration_seconds: number | null;
};

async function withStates(learn: LearnSupabaseClient, items: ItemRow[]): Promise<VideoRow[]> {
  const ids = items.map((item) => item.external_id);
  const states = new Map<string, { state: TranscriptState; last_error: string | null }>();
  for (let from = 0; from < ids.length; from += 200) {
    const { data, error } = await learn
      .from('video_transcripts')
      .select('video_id, state, last_error')
      .in('video_id', ids.slice(from, from + 200));
    if (error) throw new Error(`Reading transcript states failed: ${error.message}`);
    for (const row of (data ?? []) as { video_id: string; state: TranscriptState; last_error: string | null }[]) {
      states.set(row.video_id, row);
    }
  }

  return items.map((item) => {
    const state = states.get(item.external_id);
    return {
      itemId: item.id,
      videoId: item.external_id,
      title: item.title,
      url: item.canonical_url,
      publishedAt: item.published_at,
      durationSeconds: item.duration_seconds,
      state: state?.state ?? null,
      note: state && state.state !== 'fetched' ? state.last_error : null,
    };
  });
}

export type PlaylistRow = {
  itemId: string;
  playlistId: string;
  title: string;
  url: string;
  videos: number;
};

export type ChannelPage = {
  channel: ChannelSummary;
  playlists: PlaylistRow[];
  videos: VideoRow[];
  /** Whether there are more videos past this page. */
  more: boolean;
};

export const VIDEOS_PER_PAGE = 50;

export async function loadChannelPage(
  learn: LearnSupabaseClient,
  slug: string,
  options: { page: number; search: string },
): Promise<ChannelPage | null> {
  const provider = await learn
    .from('catalogue_providers')
    .select(PROVIDER_COLUMNS)
    .eq('slug', slug)
    .not('youtube_channel_id', 'is', null)
    .maybeSingle();
  if (provider.error) throw new Error(`Reading the channel failed: ${provider.error.message}`);
  if (!provider.data) return null;
  const row = provider.data as ProviderRow;

  const playlists = await learn
    .from('catalogue_items')
    .select('id, external_id, title, canonical_url, members:catalogue_course_items!catalogue_course_items_course_item_id_fkey(count)')
    .eq('provider_id', row.id)
    .eq('kind', 'course')
    .order('title');
  if (playlists.error) throw new Error(`Reading playlists failed: ${playlists.error.message}`);

  const from = options.page * VIDEOS_PER_PAGE;
  let videosQuery = learn
    .from('catalogue_items')
    .select('id, external_id, title, canonical_url, published_at, duration_seconds')
    .eq('provider_id', row.id)
    .eq('kind', 'video');
  if (options.search) videosQuery = videosQuery.ilike('title', `%${options.search.replace(/[%_]/g, '')}%`);
  const videos = await videosQuery
    .order('published_at', { ascending: false, nullsFirst: false })
    .range(from, from + VIDEOS_PER_PAGE);
  if (videos.error) throw new Error(`Reading videos failed: ${videos.error.message}`);

  const items = (videos.data ?? []) as ItemRow[];
  const playlistRows = (
    (playlists.data ?? []) as { id: string; external_id: string; title: string; canonical_url: string; members: { count: number }[] }[]
  ).map((playlist) => ({
    itemId: playlist.id,
    playlistId: playlist.external_id,
    title: playlist.title,
    url: playlist.canonical_url,
    videos: playlist.members[0]?.count ?? 0,
  }));

  return {
    channel: toSummary(row, await countItems(learn, row.id, 'video'), playlistRows.length),
    playlists: playlistRows,
    videos: await withStates(learn, items.slice(0, VIDEOS_PER_PAGE)),
    more: items.length > VIDEOS_PER_PAGE,
  };
}

export type PlaylistPage = {
  channel: { slug: string; name: string };
  playlist: PlaylistRow;
  videos: VideoRow[];
};

export async function loadPlaylistPage(learn: LearnSupabaseClient, itemId: string): Promise<PlaylistPage | null> {
  const head = await learn
    .from('catalogue_items')
    .select('id, external_id, title, canonical_url, provider:catalogue_providers!catalogue_items_provider_id_fkey(slug, name)')
    .eq('id', itemId)
    .eq('kind', 'course')
    .maybeSingle();
  if (head.error) throw new Error(`Reading the playlist failed: ${head.error.message}`);
  if (!head.data) return null;
  const playlist = head.data as {
    id: string;
    external_id: string;
    title: string;
    canonical_url: string;
    provider: { slug: string; name: string } | { slug: string; name: string }[] | null;
  };
  const provider = Array.isArray(playlist.provider) ? playlist.provider[0] : playlist.provider;
  if (!provider) return null;

  const members = await learn
    .from('catalogue_course_items')
    .select('position, member:catalogue_items!catalogue_course_items_member_item_id_fkey(id, external_id, title, canonical_url, published_at, duration_seconds)')
    .eq('course_item_id', itemId)
    .order('position')
    .limit(1000);
  if (members.error) throw new Error(`Reading the playlist's videos failed: ${members.error.message}`);

  const items = ((members.data ?? []) as { member: ItemRow | ItemRow[] | null }[])
    .map((row) => (Array.isArray(row.member) ? row.member[0] : row.member))
    .filter((item): item is ItemRow => item !== null && item !== undefined);

  return {
    channel: provider,
    playlist: {
      itemId: playlist.id,
      playlistId: playlist.external_id,
      title: playlist.title,
      url: playlist.canonical_url,
      videos: items.length,
    },
    videos: await withStates(learn, items),
  };
}

export type VideoPage = {
  video: VideoRow;
  description: string | null;
  channel: { slug: string; name: string } | null;
  segments: { tStartSeconds: number | null; tEndSeconds: number | null; embedded: boolean }[];
};

export async function loadVideoPage(learn: LearnSupabaseClient, videoId: string): Promise<VideoPage | null> {
  const { data, error } = await learn
    .from('catalogue_items')
    .select('id, external_id, title, canonical_url, published_at, duration_seconds, description, provider:catalogue_providers!catalogue_items_provider_id_fkey(slug, name, youtube_channel_id)')
    .eq('kind', 'video')
    .eq('external_id', videoId)
    .limit(1);
  if (error) throw new Error(`Reading the video failed: ${error.message}`);
  const item = (data ?? [])[0] as
    | (ItemRow & {
        description: string | null;
        provider: { slug: string; name: string; youtube_channel_id: string | null } | { slug: string; name: string; youtube_channel_id: string | null }[] | null;
      })
    | undefined;
  if (!item) return null;

  const provider = Array.isArray(item.provider) ? item.provider[0] : item.provider;
  const [video] = await withStates(learn, [item]);

  const segments = await learn
    .from('catalogue_segments')
    .select('t_start_seconds, t_end_seconds, embedding_model')
    .eq('item_id', item.id)
    .order('ordinal');
  if (segments.error) throw new Error(`Reading the video's segments failed: ${segments.error.message}`);

  return {
    video,
    description: item.description,
    channel: provider?.youtube_channel_id ? { slug: provider.slug, name: provider.name } : null,
    segments: (
      (segments.data ?? []) as { t_start_seconds: number | null; t_end_seconds: number | null; embedding_model: string | null }[]
    ).map((segment) => ({
      tStartSeconds: segment.t_start_seconds,
      tEndSeconds: segment.t_end_seconds,
      embedded: segment.embedding_model !== null,
    })),
  };
}
