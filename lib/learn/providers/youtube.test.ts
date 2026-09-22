import { describe, expect, it } from 'vitest';
import {
  chaptersFromDescription,
  lectureLabel,
  parseIsoDuration,
  parsePlaylistItemsPage,
  parsePlaylistResponse,
  parseVideosResponse,
  playlistItemsRequestUrl,
  videosRequestUrl,
} from '@/lib/learn/providers/youtube';

/**
 * What the Data API answers, and what this repository makes of it.
 *
 * Everything here is a pure function over a response body, so the cases that
 * would otherwise only be met in production -- a lecture deleted out of the
 * middle of a course, a live stream with no duration, a description that
 * mentions a time without being a chapter list -- are met here instead. No
 * key and no network: the calls that need both are three lines of glue over
 * these.
 */

describe('parseIsoDuration', () => {
  it('reads the shape the API actually sends', () => {
    expect(parseIsoDuration('PT1H23M45S')).toBe(5025);
    expect(parseIsoDuration('PT45S')).toBe(45);
    expect(parseIsoDuration('PT39M')).toBe(2340);
  });

  it('is null rather than zero for a duration that means nothing', () => {
    // What a live stream that never ended answers, and what
    // `catalogue_items_duration_ck` refuses.
    expect(parseIsoDuration('P0D')).toBeNull();
    expect(parseIsoDuration('')).toBeNull();
    expect(parseIsoDuration('39 minutes')).toBeNull();
  });
});

describe('chaptersFromDescription', () => {
  const description = [
    'Lecture 1 of MIT 18.06 Linear Algebra, Spring 2010.',
    '',
    '0:00 The geometry of linear equations',
    '3:45 - Row picture',
    '12:30 Column picture',
    '1:02:10 Matrix picture',
    '',
    'License: Creative Commons BY-NC-SA',
  ].join('\n');

  it('takes the markers the lecture publishes itself', () => {
    expect(chaptersFromDescription(description)).toEqual([
      { startSeconds: 0, title: 'The geometry of linear equations' },
      { startSeconds: 225, title: 'Row picture' },
      { startSeconds: 750, title: 'Column picture' },
      { startSeconds: 3730, title: 'Matrix picture' },
    ]);
  });

  it('refuses a description that merely mentions a time', () => {
    expect(chaptersFromDescription('The proof starts at 4:32, if you want it.')).toEqual([]);
  });

  it('refuses a list that does not start at the beginning', () => {
    const late = ['1:20 One', '4:00 Two', '9:00 Three'].join('\n');
    expect(chaptersFromDescription(late)).toEqual([]);
  });

  it('refuses markers too close together to be chapters', () => {
    const rapid = ['0:00 One', '0:04 Two', '0:09 Three'].join('\n');
    expect(chaptersFromDescription(rapid)).toEqual([]);
  });
});

describe('lectureLabel', () => {
  it('takes the provider numbering verbatim', () => {
    expect(lectureLabel('Lecture 7: Eigenvalues')).toBe('Lecture 7');
    expect(lectureLabel('Lec 3 | MIT 18.06 Linear Algebra')).toBe('Lec 3');
    expect(lectureLabel('Unit 2 -- Supply')).toBe('Unit 2');
  });

  it('invents nothing for a title with no numbering', () => {
    expect(lectureLabel('The Geometry of Linear Equations')).toBeNull();
    expect(lectureLabel('1. The Geometry of Linear Equations')).toBeNull();
  });
});

describe('parsePlaylistResponse', () => {
  it('reads the course title and the channel it came from', () => {
    const body = JSON.stringify({
      items: [
        {
          id: 'PL1',
          snippet: {
            title: 'MIT 18.06 Linear Algebra',
            description: 'Spring 2010',
            channelId: 'UCEBb1b_L6zDS3xTUrIALZOw',
            channelTitle: 'MIT OpenCourseWare',
          },
        },
      ],
    });

    expect(parsePlaylistResponse(body)).toEqual({
      ok: true,
      title: 'MIT 18.06 Linear Algebra',
      description: 'Spring 2010',
      channelId: 'UCEBb1b_L6zDS3xTUrIALZOw',
      channelTitle: 'MIT OpenCourseWare',
    });
  });

  it('calls an id nothing answers for not-found', () => {
    const result = parsePlaylistResponse(JSON.stringify({ items: [] }));
    expect(result).toMatchObject({ ok: false, reason: 'not-found' });
  });

  it('does not mistake a non-JSON body for a playlist', () => {
    expect(parsePlaylistResponse('<html>no</html>')).toMatchObject({ ok: false, reason: 'error' });
  });
});

describe('parsePlaylistItemsPage', () => {
  it('keeps the published order and drops what is no longer there', () => {
    const body = JSON.stringify({
      nextPageToken: 'page-2',
      items: [
        { contentDetails: { videoId: 'a' } },
        // A lecture deleted out of the middle of the course.
        { snippet: { title: 'Deleted video' } },
        { contentDetails: { videoId: 'b' } },
        // The same lecture listed twice; only its first place is kept.
        { contentDetails: { videoId: 'a' } },
      ],
    });

    expect(parsePlaylistItemsPage(body)).toEqual({
      ok: true,
      videoIds: ['a', 'b'],
      nextPageToken: 'page-2',
    });
  });

  it('says there is no next page when there is not', () => {
    const body = JSON.stringify({ items: [{ contentDetails: { videoId: 'a' } }] });
    expect(parsePlaylistItemsPage(body)).toMatchObject({ nextPageToken: null });
  });
});

describe('parseVideosResponse', () => {
  it('turns a video into the columns catalogue_items has', () => {
    const body = JSON.stringify({
      items: [
        {
          id: 'abc123',
          snippet: {
            title: 'Lecture 1: The Geometry of Linear Equations',
            description: '0:00 Start',
            publishedAt: '2009-05-06T18:22:11Z',
          },
          contentDetails: { duration: 'PT39M49S' },
        },
      ],
    });

    const parsed = parseVideosResponse(body);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.videos).toEqual([
      {
        videoId: 'abc123',
        title: 'Lecture 1: The Geometry of Linear Equations',
        description: '0:00 Start',
        canonicalUrl: 'https://www.youtube.com/watch?v=abc123',
        durationSeconds: 2389,
        publishedAt: '2009-05-06',
      },
    ]);
  });

  it('leaves out a video the API returned nothing about', () => {
    const body = JSON.stringify({ items: [{ id: 'private-one' }] });
    const parsed = parseVideosResponse(body);
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    expect(parsed.videos).toEqual([]);
  });
});

describe('the requests themselves', () => {
  it('walks playlists rather than searching, which is 1 quota unit against 100', () => {
    const url = new URL(playlistItemsRequestUrl('PL1', 'the-key', 'page-2'));
    expect(url.pathname.endsWith('/playlistItems')).toBe(true);
    expect(url.searchParams.get('playlistId')).toBe('PL1');
    expect(url.searchParams.get('pageToken')).toBe('page-2');
    expect(url.searchParams.get('key')).toBe('the-key');
  });

  it('asks for fifty videos in one call', () => {
    const ids = Array.from({ length: 50 }, (_, i) => `v${i}`);
    const url = new URL(videosRequestUrl(ids, 'the-key'));
    expect(url.searchParams.get('id')?.split(',')).toHaveLength(50);
    expect(url.searchParams.get('part')).toBe('snippet,contentDetails');
  });
});
