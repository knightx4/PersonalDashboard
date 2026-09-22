import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchResult } from '@/lib/learn/providers/fetch';
import { segmentsForVideo } from '@/lib/learn/catalogue/segment';

/**
 * Finding a lecture's transcript on ocw.mit.edu.
 *
 * The fixtures are excerpts of the real pages for 18.06 Linear Algebra,
 * fetched 2026-09-22: the course page's gallery link, the first three cards
 * of its video gallery, lecture 1's player, and the first twelve minutes of
 * lecture 1's caption file. Each carries a comment naming its source.
 */

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/ocw/${name}`, import.meta.url), 'utf8');

const COURSE = 'https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/';
const GALLERY = `${COURSE}video_galleries/video-lectures/`;
const LECTURE_1 = `${COURSE}resources/lecture-1-the-geometry-of-linear-equations/`;
const CAPTIONS_1 = `${COURSE}d292ec07b3ed5124ae1409dc520e61fe_J7DzL2_Na80.vtt`;

/** The description mitocw gives lecture 1 on YouTube, as it reads today. */
const DESCRIPTION = [
  'MIT 18.06 Linear Algebra, Spring 2005',
  'Instructor: Gilbert Strang',
  'View the complete course: http://ocw.mit.edu/18-06S05',
  'YouTube Playlist: https://www.youtube.com/playlist?list=PLE7DDD91010BC51F8',
  '',
  '1. The Geometry of Linear Equations',
  '',
  'License: Creative Commons BY-NC-SA',
  'More information at https://ocw.mit.edu/terms',
  'More courses at https://ocw.mit.edu',
].join('\n');

const fetched = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock('./fetch', () => ({
  fetchDocument: async (url: string): Promise<FetchResult> => {
    fetched.calls.push(url);
    // The short link redirects twice before it lands on the course.
    const pages: Record<string, { url: string; file: string }> = {
      'https://ocw.mit.edu/18-06S05': { url: COURSE, file: 'course.html' },
      [GALLERY]: { url: GALLERY, file: 'gallery.html' },
      [LECTURE_1]: { url: LECTURE_1, file: 'resource.html' },
      [CAPTIONS_1]: { url: CAPTIONS_1, file: 'lecture-1.vtt' },
    };
    const page = pages[url];
    if (!page) return { ok: false, reason: 'not-found', detail: '404' };
    const text = fixture(page.file);
    return { ok: true, url: page.url, contentType: 'text', text, bytes: null, byteLength: text.length };
  },
}));

const ocw = await import('@/lib/learn/providers/ocw');

beforeEach(() => {
  fetched.calls.length = 0;
});

describe('ocwCourseUrlFromDescription', () => {
  it('takes the course link and skips the licence and the site root', () => {
    expect(ocw.ocwCourseUrlFromDescription(DESCRIPTION)).toBe('https://ocw.mit.edu/18-06S05');
  });

  it('reads the newer https and full-address forms', () => {
    expect(ocw.ocwCourseUrlFromDescription('View the complete course: https://ocw.mit.edu/6-006S20.')).toBe(
      'https://ocw.mit.edu/6-006S20',
    );
    expect(
      ocw.ocwCourseUrlFromDescription('Course: https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/'),
    ).toBe('https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/');
  });

  it('is null for a video that names no course', () => {
    expect(ocw.ocwCourseUrlFromDescription('More courses at https://ocw.mit.edu')).toBeNull();
    expect(ocw.ocwCourseUrlFromDescription('A lecture on something.')).toBeNull();
  });
});

describe('the page parsers, on the real pages', () => {
  it('finds the gallery the course page links', () => {
    expect(ocw.galleryUrlsFromCoursePage(fixture('course.html'), COURSE)).toEqual([GALLERY]);
  });

  it('maps each gallery card to its video id', () => {
    const pages = ocw.lecturePagesFromGallery(fixture('gallery.html'), GALLERY);
    expect([...pages.keys()]).toEqual(['J7DzL2_Na80', 'QVKj3LADCnA', 'FX4C-JpTFgY']);
    expect(pages.get('J7DzL2_Na80')).toBe(LECTURE_1);
  });

  it('takes the English caption track, and only for the video asked about', () => {
    expect(ocw.captionUrlFromLecturePage(fixture('resource.html'), LECTURE_1, 'J7DzL2_Na80')).toBe(CAPTIONS_1);
    expect(ocw.captionUrlFromLecturePage(fixture('resource.html'), LECTURE_1, 'QVKj3LADCnA')).toBeNull();
  });
});

describe('cuesFromVtt', () => {
  it('reads the real caption file into timed cues, one line each', () => {
    const cues = ocw.cuesFromVtt(fixture('lecture-1.vtt'));
    expect(cues[0]).toEqual({ startSeconds: 8.711, endSeconds: 9.21, text: 'Hi.' });
    expect(cues[1]).toEqual({
      startSeconds: 9.21,
      endSeconds: 14.23,
      text: "This is the first lecture in MIT's course 18.06,",
    });
    expect(cues.at(-1)?.startSeconds).toBeCloseTo(719.62);
  });

  it('drops tags, speaker markers and entities, and reads a timestamp with no hours', () => {
    const vtt = 'WEBVTT\n\n01:02.500 --> 01:04.000\n&gt;&gt; <i>PROFESSOR:</i> Q &amp; A.\n';
    expect(ocw.cuesFromVtt(vtt)).toEqual([{ startSeconds: 62.5, endSeconds: 64, text: 'PROFESSOR: Q & A.' }]);
  });
});

describe('ocwTranscriptLookup', () => {
  it('follows a video from its description to its transcript', async () => {
    const lookup = ocw.ocwTranscriptLookup();
    const cues = await lookup({ videoId: 'J7DzL2_Na80', description: DESCRIPTION });

    expect(cues?.[0].text).toBe('Hi.');
    expect(fetched.calls).toEqual(['https://ocw.mit.edu/18-06S05', GALLERY, LECTURE_1, CAPTIONS_1]);
  });

  it('reads the course once for the whole course', async () => {
    const lookup = ocw.ocwTranscriptLookup();
    await lookup({ videoId: 'J7DzL2_Na80', description: DESCRIPTION });
    // Lecture 2's page is not in the fixtures, so it comes back empty; what
    // matters is that the course and gallery were not fetched again.
    expect(await lookup({ videoId: 'QVKj3LADCnA', description: DESCRIPTION })).toBeNull();
    expect(fetched.calls.filter((url) => url === GALLERY)).toHaveLength(1);
  });

  it('is null for a video the course does not list, or that names no course', async () => {
    const lookup = ocw.ocwTranscriptLookup();
    expect(await lookup({ videoId: 'aaaaaaaaaaa', description: DESCRIPTION })).toBeNull();
    expect(await lookup({ videoId: 'J7DzL2_Na80', description: 'No link here.' })).toBeNull();
  });

  it('gives the cutter what it needs to make timed clips', async () => {
    const cues = await ocw.ocwTranscriptLookup()({ videoId: 'J7DzL2_Na80', description: DESCRIPTION });
    const { segments, cutBy } = segmentsForVideo(
      { title: 'Lecture 1', description: DESCRIPTION, durationSeconds: 2389, chapters: [] },
      cues,
    );

    expect(cutBy).toBe('transcript');
    expect(segments.length).toBeGreaterThan(1);
    for (const segment of segments.slice(0, -1)) {
      const length = (segment.tEndSeconds ?? 0) - (segment.tStartSeconds ?? 0);
      expect(length).toBeGreaterThanOrEqual(180);
      expect(length).toBeLessThanOrEqual(360);
      expect(segment.text.trim()).toMatch(/[.!?]["')\]]?$/);
    }
    // Each span after the first starts before the previous one ended.
    expect(segments[1].tStartSeconds).toBeLessThan(segments[0].tEndSeconds ?? 0);
  });
});
