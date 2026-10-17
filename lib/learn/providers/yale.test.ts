import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchResult } from '@/lib/learn/providers/fetch';
import { mayFeedText, mayShowText, structureRow, unitRows } from '@/lib/learn/catalogue/structure';

/**
 * Open Yale Courses lecture lists. The fixtures in fixtures/structure/yale/
 * come from live fetches on 2026-10-16: the HIST 116 course page and its
 * Lecture 2 page.
 */

const fixture = (name: string) => readFileSync(new URL(`./fixtures/structure/yale/${name}`, import.meta.url), 'utf8');

const COURSE = 'https://oyc.yale.edu/history/hist-116';
const LECTURE_2 = 'https://oyc.yale.edu/history/hist-116/lecture-2';

const fetched = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock('./fetch', () => ({
  fetchDocument: async (url: string): Promise<FetchResult> => {
    fetched.calls.push(url);
    const name =
      url === 'https://oyc.yale.edu/history/hist-116'
        ? 'hist-116.html'
        : url.endsWith('/lecture-2')
          ? 'hist-116-lecture-2.html'
          : null;
    if (!name) return { ok: false, reason: 'not-found', detail: '404' };
    const text = readFileSync(new URL(`./fixtures/structure/yale/${name}`, import.meta.url), 'utf8');
    return { ok: true, url, contentType: 'html', text, bytes: null, byteLength: text.length };
  },
}));

const yale = await import('@/lib/learn/providers/yale');

beforeEach(() => {
  fetched.calls.length = 0;
});

describe('the HIST 116 course page', () => {
  const course = yale.parseYaleCourse(fixture('hist-116.html'), COURSE);

  it('reads the course facts', () => {
    expect(course.title).toBe('The American Revolution');
    expect(course.courseCode).toBe('HIST 116');
    expect(course.professor).toContain('Joanne Freeman');
    expect(course.term).toBe('Spring 2010');
    expect(course.about).toContain('remarkable transformations');
    expect(course.texts).toHaveLength(11);
    expect(course.texts[0]).toContain('Faces of Revolution');
  });

  it('lists the 25 lectures in order with their pages', () => {
    expect(course.lectures).toHaveLength(25);
    expect(course.lectures[0]).toMatchObject({
      number: 'Lecture 1',
      title: "Introduction: Freeman's Top Five Tips for Studying the Revolution",
      url: 'https://oyc.yale.edu/history/hist-116/lecture-1',
    });
    expect(course.lectures[24]).toMatchObject({
      number: 'Lecture 25',
      title: 'Being an American: The Legacy of the Revolution',
    });
    expect(course.lectures.map((l) => l.number)).toEqual(Array.from({ length: 25 }, (_, i) => `Lecture ${i + 1}`));
  });
});

describe('a lecture page', () => {
  it('reads chapters, video, audio and the inline transcript', () => {
    const lecture = yale.parseYaleLecture(fixture('hist-116-lecture-2.html'), LECTURE_2);
    expect(lecture.chapters).toHaveLength(5);
    expect(lecture.chapters[0]).toBe('Introduction');
    expect(lecture.youtubeUrl).toBe('https://www.youtube.com/watch?v=8_ltTMQ6Gsg');
    expect(lecture.audioUrl).toBe(
      'https://oyc.yale.edu/sites/default/files/courses/spring10/hist116/mp3/hist116_02_011410.mp3',
    );
    expect(lecture.hasTranscript).toBe(true);
  });

  it('says so when a page has no transcript', () => {
    expect(yale.parseYaleLecture('<html><body>no</body></html>', LECTURE_2)).toMatchObject({
      hasTranscript: false,
      chapters: [],
    });
  });
});

describe('pulling a course', () => {
  it('refuses an address that is not a course page, without fetching', async () => {
    for (const bad of [
      'https://example.com/history/hist-116',
      'http://oyc.yale.edu/history/hist-116',
      'https://oyc.yale.edu/',
      'https://oyc.yale.edu/history/hist-116/lecture-2',
    ]) {
      expect(await yale.pullYaleCourse(bad)).toMatchObject({ ok: false, reason: 'not-allowlisted' });
    }
    expect(fetched.calls).toEqual([]);
  });

  it('stores the lectures as ordered units, with transcript links, under show', async () => {
    const result = await yale.pullYaleCourse(`${COURSE}?x=1`);
    if (!result.ok) throw new Error(result.detail);
    const doc = result.document;
    expect(doc).toMatchObject({
      providerSlug: 'yale-courses',
      externalId: 'hist-116',
      courseCode: 'HIST 116',
      term: 'Spring 2010',
      licenceMode: 'show',
      canonicalUrl: COURSE,
    });
    expect(mayShowText(doc.licenceMode)).toBe(true);
    expect(mayFeedText(doc.licenceMode)).toBe(true);
    expect(doc.institution).toContain('CC BY-NC-SA');
    expect(doc.units).toHaveLength(25);
    expect(doc.units[1]).toMatchObject({ label: 'Lecture 2', heading: 'Being a British Colonist' });
    expect(doc.units[1].topics).toHaveLength(5);
    expect(doc.units[1].readings.map((r) => r.title)).toEqual([
      'Being a British Colonist (lecture page with transcript)',
      'Being a British Colonist (video)',
      'Being a British Colonist (audio)',
    ]);
    expect(doc.units[1].readings[0].url).toBe(LECTURE_2);
    // A lecture page that will not load keeps its link and no topics.
    expect(doc.units[2]).toMatchObject({ topics: [], readings: [{ title: 'Being a British American (lecture page)' }] });
    expect(doc.rawText).not.toContain('end of transcript');
    expect(structureRow(doc).content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(unitRows(doc.units)).toHaveLength(25);
  });

  it('reports a page that will not load', async () => {
    expect(await yale.pullYaleCourse('https://oyc.yale.edu/history/hist-999')).toMatchObject({
      ok: false,
      reason: 'fetch-failed',
    });
  });
});
