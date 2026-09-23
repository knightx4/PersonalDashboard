import { describe, expect, it, vi } from 'vitest';
import type postgres from 'postgres';
import type { EmbedSweepResult } from './embed-sweep';
import { parsePlaylistId, pullCourse, type CoursePullPorts } from './pull-course';
import type { CatalogueCourseInput } from './store';
import type { CourseSweepResult } from './sweep';

vi.mock('@/lib/learn/providers/youtube', async (original) => ({
  ...(await original<typeof import('@/lib/learn/providers/youtube')>()),
  fetchYouTubePlaylist: vi.fn(),
}));
vi.mock('./store', async (original) => ({
  ...(await original<typeof import('./store')>()),
  storeCourse: vi.fn(),
}));

const { fetchYouTubePlaylist } = await import('@/lib/learn/providers/youtube');
const { storeCourse } = await import('./store');
const { sweepYouTubeCourse } = await import('./sweep');

function swept(overrides: Partial<EmbedSweepResult> = {}): EmbedSweepResult {
  return { embedded: 0, skipped: 0, calls: 0, tokens: 0, model: null, stopped: null, ...overrides };
}

function storedCourse(overrides: Partial<Extract<CourseSweepResult, { ok: true }>> = {}): CourseSweepResult {
  return {
    ok: true,
    title: 'MIT 18.06 Linear Algebra, Spring 2005',
    cutBy: { transcript: 30, chapters: 0, whole: 4 },
    notReached: 0,
    refused: [],
    courseItemId: 'course',
    videos: 34,
    written: 600,
    removed: 0,
    kept: 0,
    ...overrides,
  };
}

function ports(overrides: Partial<CoursePullPorts> = {}): CoursePullPorts {
  return {
    sweep: vi.fn(async () => storedCourse()),
    embed: vi.fn(async () => swept({ embedded: 600, calls: 10, tokens: 90000, model: 'voyage-3.5' })),
    ...overrides,
  };
}

describe('parsePlaylistId', () => {
  it('takes a bare id', () => {
    expect(parsePlaylistId('  PLE7DDD91010BC51F8 ')).toEqual({ ok: true, playlistId: 'PLE7DDD91010BC51F8' });
  });

  it('reads the id out of a playlist or watch link', () => {
    expect(parsePlaylistId('https://www.youtube.com/playlist?list=PLE7DDD91010BC51F8')).toEqual({
      ok: true,
      playlistId: 'PLE7DDD91010BC51F8',
    });
    expect(
      parsePlaylistId('https://www.youtube.com/watch?v=QVKj3LADCnA&list=PLE7DDD91010BC51F8&index=2'),
    ).toEqual({ ok: true, playlistId: 'PLE7DDD91010BC51F8' });
  });

  it('refuses nothing, a link with no list, and text that is not an id', () => {
    expect(parsePlaylistId('').ok).toBe(false);
    expect(parsePlaylistId('https://www.youtube.com/watch?v=QVKj3LADCnA').ok).toBe(false);
    expect(parsePlaylistId('linear algebra lectures').ok).toBe(false);
  });
});

describe('pullCourse', () => {
  it('stores the course, then embeds', async () => {
    const p = ports();
    const report = await pullCourse(p);

    expect(report.course).toMatchObject({ ok: true, videos: 34, segments: 600, notReached: 0 });
    expect(report.embedding).toEqual({ embedded: 600, tokens: 90000, stopped: null, capped: false });
    expect(p.embed).toHaveBeenCalledTimes(1);
  });

  it('shows a missing YouTube key and embeds nothing', async () => {
    const p = ports({
      sweep: vi.fn(async () => ({ ok: false as const, reason: 'no-key', detail: 'YOUTUBE_API_KEY is not set' })),
    });
    const report = await pullCourse(p);

    expect(report.course).toEqual({ ok: false, reason: 'no-key', detail: 'YOUTUBE_API_KEY is not set' });
    expect(report.embedding).toBeNull();
    expect(p.embed).not.toHaveBeenCalled();
  });

  it('turns a thrown store into a line rather than an error page', async () => {
    const report = await pullCourse(
      ports({
        sweep: vi.fn(async () => {
          throw new Error('connection refused');
        }),
      }),
    );
    expect(report.course).toEqual({ ok: false, reason: 'store', detail: 'connection refused' });
  });

  it('carries how far it got when time ran out, and what ocw.mit.edu refused', async () => {
    const refused = ['a: timeout', 'b: timeout', 'c: timeout', 'd: timeout'];
    const report = await pullCourse(
      ports({
        sweep: vi.fn(async () => storedCourse({ notReached: 12, refused })),
        embed: vi.fn(async () =>
          swept({ embedded: 200, stopped: { reason: 'time', detail: 'ran out' } }),
        ),
      }),
    );

    expect(report.course).toMatchObject({ ok: true, notReached: 12, refusedCount: 4 });
    expect(report.course.ok && report.course.refused).toHaveLength(3);
    expect(report.embedding?.stopped?.reason).toBe('time');
  });

  it('reports a Voyage refusal after the course is stored', async () => {
    const report = await pullCourse(
      ports({ embed: vi.fn(async () => swept({ stopped: { reason: 'no-key', detail: 'EMBEDDING_API_KEY is not set' } })) }),
    );
    expect(report.course.ok).toBe(true);
    expect(report.embedding?.stopped?.reason).toBe('no-key');
  });
});

describe('sweepYouTubeCourse, as a press drives it', () => {
  const video = (n: number) => ({
    videoId: `video${String(n).padStart(6, '0')}`,
    title: `Lecture ${n}: Topic ${n}`,
    description: '',
    canonicalUrl: `https://www.youtube.com/watch?v=video${n}`,
    durationSeconds: 3000,
    publishedAt: null,
  });

  function playlist(count: number) {
    vi.mocked(fetchYouTubePlaylist).mockResolvedValue({
      ok: true,
      playlistId: 'PLE7DDD91010BC51F8',
      title: 'MIT 18.06',
      description: '',
      canonicalUrl: 'https://www.youtube.com/playlist?list=PLE7DDD91010BC51F8',
      channelId: 'UCEBb1b_L6zDS3xTUrIALZOw',
      channelTitle: 'MIT OpenCourseWare',
      videos: Array.from({ length: count }, (_, index) => video(index + 1)),
    });
  }

  function captured(): CatalogueCourseInput {
    const calls = vi.mocked(storeCourse).mock.calls;
    return calls[calls.length - 1][1];
  }

  const cues = [
    { startSeconds: 0, endSeconds: 60, text: 'Today we start linear algebra.' },
    { startSeconds: 60, endSeconds: 120, text: 'Here is the row picture.' },
  ];
  const sql = {} as postgres.Sql;

  it('stops looking up transcripts at the deadline and still stores every lecture in order', async () => {
    playlist(4);
    vi.mocked(storeCourse).mockImplementation(async (_sql, course) => ({
      courseItemId: 'course',
      videos: course.videos.length,
      written: 0,
      removed: 0,
      kept: 0,
    }));
    let clock = 0;
    const lookups: string[] = [];

    const result = await sweepYouTubeCourse(sql, {
      providerSlug: 'mit-ocw',
      playlistId: 'PLE7DDD91010BC51F8',
      transcripts: async ({ videoId }) => {
        lookups.push(videoId);
        clock += 100;
        return cues;
      },
      deadline: 150,
      now: () => clock,
    });

    expect(lookups).toHaveLength(2);
    expect(result).toMatchObject({ ok: true, notReached: 2, cutBy: { transcript: 2, chapters: 0, whole: 2 } });
    expect(captured().videos.map((v) => v.title)).toEqual([
      'Lecture 1: Topic 1',
      'Lecture 2: Topic 2',
      'Lecture 3: Topic 3',
      'Lecture 4: Topic 4',
    ]);
  });

  it('leaves the lectures already cut from a transcript alone on a second press', async () => {
    playlist(3);
    const lookups: string[] = [];

    const result = await sweepYouTubeCourse(sql, {
      providerSlug: 'mit-ocw',
      playlistId: 'PLE7DDD91010BC51F8',
      transcripts: async ({ videoId }) => {
        lookups.push(videoId);
        return cues;
      },
      keep: async (ids) => new Set(ids.slice(0, 2)),
    });

    expect(lookups).toEqual(['video000003']);
    expect(captured().videos.map((v) => v.segments === null)).toEqual([true, true, false]);
    expect(result).toMatchObject({ ok: true, cutBy: { transcript: 1, chapters: 0, whole: 0 } });
  });
});
