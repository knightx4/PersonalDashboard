import { describe, expect, it } from 'vitest';
import {
  buildInspirationPage,
  parseInspirationView,
  playlistUrl,
  type LinkRow,
  type TakeawayRowData,
  type VideoRow,
} from './view';

function video(id: string, videoId: string, extra: Partial<VideoRow> = {}): VideoRow {
  return {
    id,
    video_id: videoId,
    title: `Video ${id}`,
    channel_title: 'Channel',
    duration_seconds: 600,
    thumbnail_url: null,
    playlist_position: null,
    added_at: '2026-10-01T00:00:00Z',
    left_playlist_at: null,
    transcript_state: 'fetched',
    transcript_error: null,
    processed_at: '2026-10-02T00:00:00Z',
    takeaway_count: 1,
    process_error: null,
    ...extra,
  };
}

function takeaway(id: string, created: string, extra: Partial<TakeawayRowData> = {}): TakeawayRowData {
  return {
    id,
    title: `Takeaway ${id}`,
    body: `Body ${id}`,
    module: null,
    status: 'open',
    idea_id: null,
    plan_item_id: null,
    created_at: created,
    ...extra,
  };
}

const link = (takeawayId: string, videoRowId: string, extra: Partial<LinkRow> = {}): LinkRow => ({
  takeaway_id: takeawayId,
  video_id: videoRowId,
  said: null,
  quote: null,
  start_seconds: null,
  ...extra,
});

const empty = { planNumbers: new Map<string, number>(), ideaPlanItems: new Map<string, string | null>() };

describe('buildInspirationPage', () => {
  it('shows a merged takeaway once in the list, with both videos, and under each video in its own words', () => {
    const page = buildInspirationPage({
      settings: { youtube_playlist_id: 'PLabcdefghij', playlist_read_at: null, playlist_error: null },
      videos: [video('v1', 'aaaaaaaaaaa', { playlist_position: 1 }), video('v2', 'bbbbbbbbbbb', { playlist_position: 0 })],
      takeaways: [takeaway('t1', '2026-10-02T10:00:00Z')],
      links: [
        link('t1', 'v1', { said: 'First wording', quote: 'the quote', start_seconds: 754 }),
        link('t1', 'v2', { said: 'Second wording', start_seconds: 0 }),
      ],
      ...empty,
    });

    expect(page.list).toHaveLength(1);
    expect(page.list[0]!.sources.map((source) => source.videoId)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb']);
    expect(page.list[0]!.sources[0]!.href).toBe('https://www.youtube.com/watch?v=aaaaaaaaaaa&t=754s');
    expect(page.list[0]!.sources[1]!.href).toBe('https://www.youtube.com/watch?v=bbbbbbbbbbb');

    // Playlist order.
    expect(page.videos.map((v) => v.id)).toEqual(['v2', 'v1']);
    expect(page.videos[0]!.takeaways[0]!.sources).toHaveLength(1);
    expect(page.videos[0]!.takeaways[0]!.sources[0]!.said).toBe('Second wording');
    expect(page.videos[1]!.takeaways[0]!.sources[0]!.said).toBe('First wording');
  });

  it('lists newest first and keeps dismissed ones out of both views', () => {
    const page = buildInspirationPage({
      settings: null,
      videos: [video('v1', 'aaaaaaaaaaa')],
      takeaways: [
        takeaway('old', '2026-10-01T00:00:00Z'),
        takeaway('new', '2026-10-02T00:00:00Z'),
        takeaway('gone', '2026-10-03T00:00:00Z', { status: 'dismissed' }),
      ],
      links: [link('old', 'v1'), link('new', 'v1'), link('gone', 'v1')],
      ...empty,
    });

    expect(page.list.map((t) => t.id)).toEqual(['new', 'old']);
    expect(page.dismissed.map((t) => t.id)).toEqual(['gone']);
    expect(page.videos[0]!.takeaways.map((t) => t.id)).toEqual(['new', 'old']);
    expect(page.playlistId).toBeNull();
  });

  it('names the plan step a takeaway is covered by, directly or through its idea', () => {
    const page = buildInspirationPage({
      settings: null,
      videos: [],
      takeaways: [
        takeaway('direct', '2026-10-03T00:00:00Z', { status: 'covered', plan_item_id: 'p1' }),
        takeaway('via-idea', '2026-10-02T00:00:00Z', { status: 'covered', idea_id: 'i1' }),
        takeaway('idea-only', '2026-10-01T00:00:00Z', { status: 'covered', idea_id: 'i2' }),
        takeaway('open', '2026-09-30T00:00:00Z'),
      ],
      links: [],
      planNumbers: new Map([
        ['p1', 1412],
        ['p2', 99],
      ]),
      ideaPlanItems: new Map([
        ['i1', 'p2'],
        ['i2', null],
      ]),
    });

    expect(page.list.map((t) => t.cover)).toEqual([
      { kind: 'plan', number: 1412 },
      { kind: 'plan', number: 99 },
      { kind: 'idea', ideaId: 'i2' },
      null,
    ]);
  });

  it('says what happened to a video with nothing under it', () => {
    const page = buildInspirationPage({
      settings: null,
      videos: [
        video('waiting', 'aaaaaaaaaaa', { processed_at: null, transcript_state: 'queued', playlist_position: 0 }),
        video('none', 'bbbbbbbbbbb', { transcript_state: 'none', processed_at: null, playlist_position: 1 }),
        video('broke', 'ccccccccccc', { process_error: 'model refused', playlist_position: 2 }),
        video('empty', 'ddddddddddd', { takeaway_count: 0, playlist_position: 3 }),
        video('left', 'eeeeeeeeeee', { left_playlist_at: '2026-10-02T00:00:00Z', playlist_position: -1 }),
      ],
      takeaways: [],
      links: [],
      ...empty,
    });

    expect(page.videos.map((v) => [v.id, v.state.kind])).toEqual([
      ['waiting', 'waiting'],
      ['none', 'no-transcript'],
      ['broke', 'failed'],
      ['empty', 'read'],
      ['left', 'read'],
    ]);
    expect(page.videos[4]!.leftPlaylist).toBe(true);
    expect(page.videos[0]!.thumbnailUrl).toBe('https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg');
  });
});

describe('the view parameter and links', () => {
  it('reads list, and anything else as by video', () => {
    expect(parseInspirationView('list')).toBe('list');
    expect(parseInspirationView(['list'])).toBe('list');
    expect(parseInspirationView(undefined)).toBe('videos');
    expect(parseInspirationView('nonsense')).toBe('videos');
  });

  it('links the playlist', () => {
    expect(playlistUrl('PLIBpAG8AqHoE')).toBe('https://www.youtube.com/playlist?list=PLIBpAG8AqHoE');
  });
});
