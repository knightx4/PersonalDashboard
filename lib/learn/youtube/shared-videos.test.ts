/**
 * One YouTube video, one catalogue row, whichever channel finds it first.
 *
 * The catalogue held 71 videos twice, mostly TED talks that TED-Ed's
 * playlists also carry: every write keyed on (provider, video id), so a
 * channel listing another channel's video stored its own copy. These drive
 * listChannel and storeNewVideos over in-memory tables that filter on the
 * real columns (provider_id, kind, external_id), with YouTube stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { YouTubeVideo } from '@/lib/learn/providers/youtube';
import { fakeSchemaDb, type FakeTables } from '@/tests/stubs/fake-schema-db';

const youtube = vi.hoisted(() => ({
  playlists: new Map<string, string[]>(),
  channelPlaylists: [] as { playlistId: string; title: string; description: string; itemCount: number | null }[],
  detailsAsked: [] as string[][],
}));

vi.mock('@/lib/learn/providers/youtube', async (actual) => ({
  ...(await actual<typeof import('@/lib/learn/providers/youtube')>()),
  fetchPlaylistVideoIds: vi.fn(async (playlistId: string) => ({
    ok: true,
    videoIds: youtube.playlists.get(playlistId) ?? [],
    complete: true,
    addedAt: {},
  })),
  fetchVideosByIds: vi.fn(async (ids: string[]) => {
    youtube.detailsAsked.push(ids);
    return { ok: true, videos: ids.map((id) => video(id)) };
  }),
  fetchChannelPlaylists: vi.fn(async () => ({ ok: true, playlists: youtube.channelPlaylists })),
}));

const queued = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock('./transcripts', () => ({
  queueTranscripts: vi.fn(async (_learn: unknown, ids: string[]) => {
    queued.ids.push(...ids);
    return ids.length;
  }),
}));

const { listChannel } = await import('./library');
const { storeNewVideos } = await import('./watch-list');

function video(id: string, over: Partial<YouTubeVideo> = {}): YouTubeVideo {
  return {
    videoId: id,
    title: `Video ${id}`,
    description: '',
    canonicalUrl: `https://www.youtube.com/watch?v=${id}`,
    durationSeconds: 600,
    publishedAt: '2026-09-01',
    ...over,
  };
}

/** The fake, plus the `range` paging the library reads with (one page is enough here). */
function learnClient(tables: FakeTables) {
  const db = fakeSchemaDb(tables)('learn');
  return {
    from(table: string) {
      const query = db.from(table) as unknown as Record<string, unknown>;
      return Object.assign(query, { range: () => query });
    },
  } as never;
}

const TED = 'p-ted';
const TEDED = 'p-teded';

function channel(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    slug: id,
    name: id,
    youtube_channel_id: `UC-${id}`,
    youtube_handle: null,
    youtube_uploads_playlist_id: `UU-${id}`,
    youtube_listed_at: '2026-10-01T00:00:00Z',
    auto_transcribe: false,
    ...over,
  };
}

function seed(): FakeTables {
  return {
    'learn.catalogue_providers': [
      { id: TED, slug: 'ted', youtube_channel_id: `UC-${TED}` },
      { id: TEDED, slug: 'teded', youtube_channel_id: `UC-${TEDED}` },
      { id: 'p-list', slug: 'youtube-list', youtube_channel_id: null },
    ],
    'learn.catalogue_items': [
      {
        id: 'item-talk',
        provider_id: TED,
        external_id: 'talk',
        kind: 'video',
        title: 'A TED talk',
        created_at: '2026-09-20T00:00:00Z',
      },
    ],
  };
}

function rowsFor(tables: FakeTables, externalId: string) {
  return tables['learn.catalogue_items'].filter((row) => row.external_id === externalId && row.kind === 'video');
}

beforeEach(() => {
  youtube.playlists.clear();
  youtube.channelPlaylists = [];
  youtube.detailsAsked = [];
  queued.ids = [];
});

describe('a playlist holding another channel’s video', () => {
  it('links the stored row instead of storing a second one, and stores what is new under itself', async () => {
    const tables = seed();
    youtube.playlists.set(`UU-${TEDED}`, ['own']);
    youtube.playlists.set('PL-lessons', ['talk', 'own', 'unseen']);
    youtube.channelPlaylists = [{ playlistId: 'PL-lessons', title: 'Lessons', description: '', itemCount: 3 }];

    const result = await listChannel(learnClient(tables), channel(TEDED) as never, { playlists: true });

    expect(result.error).toBeNull();
    expect(rowsFor(tables, 'talk')).toHaveLength(1);
    expect(rowsFor(tables, 'talk')[0].provider_id).toBe(TED);
    expect(rowsFor(tables, 'unseen').map((row) => row.provider_id)).toEqual([TEDED]);
    // YouTube is asked only about what the catalogue lacks.
    expect(youtube.detailsAsked).toEqual([['own'], ['unseen']]);

    const course = tables['learn.catalogue_items'].find((row) => row.external_id === 'PL-lessons')!;
    const members = tables['learn.catalogue_course_items']
      .filter((row) => row.course_item_id === course.id)
      .sort((a, b) => (a.position as number) - (b.position as number))
      .map((row) => row.member_item_id);
    expect(members[0]).toBe('item-talk');
    expect(members).toHaveLength(3);
  });
});

describe('an upload another channel stored first', () => {
  it('is linked, not stored again, and still queued when the channel transcribes its uploads', async () => {
    const tables = seed();
    tables['learn.catalogue_items'].push({
      id: 'item-shared',
      provider_id: TEDED,
      external_id: 'shared',
      kind: 'video',
      title: 'Found on a TED-Ed playlist',
      created_at: '2026-09-25T00:00:00Z',
    });
    youtube.playlists.set(`UU-${TED}`, ['shared', 'brand-new', 'talk']);

    const result = await listChannel(learnClient(tables), channel(TED, { auto_transcribe: true }) as never);

    expect(rowsFor(tables, 'shared')).toHaveLength(1);
    expect(rowsFor(tables, 'brand-new').map((row) => row.provider_id)).toEqual([TED]);
    expect(result.newVideos).toBe(1);
    expect(youtube.detailsAsked).toEqual([['brand-new']]);
    expect(queued.ids.sort()).toEqual(['brand-new', 'shared']);
  });
});

describe('storeNewVideos', () => {
  it('returns the stored row for a video the catalogue has under another provider', async () => {
    const tables = seed();
    const ids = await storeNewVideos(learnClient(tables), [
      video('talk', { channelId: `UC-${TEDED}` }),
      video('fresh', { channelId: 'UC-unfollowed', channelTitle: 'Someone' }),
    ]);

    expect(ids.get('talk')).toBe('item-talk');
    expect(rowsFor(tables, 'talk')).toHaveLength(1);
    expect(rowsFor(tables, 'fresh').map((row) => row.provider_id)).toEqual(['p-list']);
    expect(ids.get('fresh')).toBe(rowsFor(tables, 'fresh')[0].id);
  });
});
