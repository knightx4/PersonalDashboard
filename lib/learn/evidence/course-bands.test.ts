import { describe, expect, it } from 'vitest';
import {
  GUESSED_SIMILARITY,
  NAMED_SIMILARITY,
  TOPICS_PER_COURSE,
  bandBasis,
  bandLinks,
  bandWords,
  courseBand,
  frameNames,
  isGraded,
  isGuessed,
  namingText,
  resolveNamedTopics,
  type Candidate,
} from './course-bands';
import type { CourseSource } from './courses';

const course = (over: Partial<CourseSource> = {}): CourseSource => ({
  course_id: 'c1',
  school: 'Yale University',
  code: 'MGT 847',
  title: 'Private Equity: Leveraged Buyouts',
  term: null,
  year: 2025,
  grade: 'H',
  notes: [],
  catalogue_description: null,
  ...over,
});

describe('the band a course marks', () => {
  it('tops out at the depth of the course with a full grade this year', () => {
    expect(courseBand({ grade: 'A', year: 2026 }, 'intro', 2026)).toEqual({ low: 1, high: 2 });
    expect(courseBand({ grade: 'A', year: 2026 }, 'intermediate', 2026)).toEqual({ low: 1, high: 3 });
    expect(courseBand({ grade: 'HH', year: 2026 }, 'advanced', 2026)).toEqual({ low: 1, high: 4 });
  });

  it('lowers the top for the grade and the years since, never under 1', () => {
    // 4 x 0.8 x 0.5^(1/8) = 2.9
    expect(courseBand({ grade: 'B', year: 2025 }, 'advanced', 2026)?.high).toBe(3);
    // 2 x 1 x 0.5^(10/8) = 0.84
    expect(courseBand({ grade: 'A', year: 2016 }, 'intro', 2026)).toEqual({ low: 1, high: 1 });
  });

  it('marks nothing for a grade that counts nothing', () => {
    expect(courseBand({ grade: 'PR', year: 2025 }, 'advanced', 2026)).toBeNull();
    expect(isGraded({ grade: 'W' })).toBe(false);
    expect(isGraded({ grade: 'TA' })).toBe(true);
  });

  it('reads as likely levels', () => {
    expect(bandWords({ low: 1, high: 1 })).toBe('likely level 1');
    expect(bandWords({ low: 1, high: 3 })).toBe('likely level 1 to 3');
  });
});

describe('the reason beside the band', () => {
  it('names the course, the depth and what the grade and years left', () => {
    expect(bandBasis(course(), 'advanced', { low: 1, high: 4 }, false, 2026)).toBe(
      'from MGT 847 Private Equity: Leveraged Buyouts, H, 2025: an advanced course reaches level 4 at most, and the grade and a year since keep 4.',
    );
    expect(bandBasis(course({ year: 2026 }), 'advanced', { low: 1, high: 4 }, false, 2026)).toBe(
      'from MGT 847 Private Equity: Leveraged Buyouts, H, 2026: an advanced course reaches level 4 at most, and the grade keeps 4.',
    );
  });

  it('flags topics guessed from the title', () => {
    const basis = bandBasis(course({ code: 'ACC 2304', title: 'Managerial Accounting', grade: 'A', year: 2017 }), 'intro', { low: 1, high: 1 }, true, 2026);
    expect(basis).toBe(
      'from ACC 2304 Managerial Accounting, A, 2017: an introductory course reaches level 2 at most, and the grade and 9 years since leave 1. Topics guessed from the course title.',
    );
  });
});

describe('what the call reads', () => {
  it('is the name, school and year, then the description and notes', () => {
    const text = namingText(course({ catalogue_description: 'Buyouts and their financing.', notes: ['Week 1: LBO math.'] }));
    expect(text).toBe(
      'Course: MGT 847 Private Equity: Leveraged Buyouts\nSchool: Yale University\nTaken: 2025\n\nBuyouts and their financing.\n\nWeek 1: LBO math.',
    );
  });

  it('is guessed when there is nothing but the title', () => {
    expect(isGuessed(course())).toBe(true);
    expect(isGuessed(course({ notes: ['A summary.'] }))).toBe(false);
  });
});

describe('the topics a call named', () => {
  const candidates: Candidate[] = [
    { id: 'investment', title: 'Investment', level: 4, similarity: 0.36 },
    { id: 'curriculum', title: 'Curriculum', level: 4, similarity: 0.35 },
    { id: 'debt', title: 'Debt', level: 4, similarity: 0.3 },
  ];
  const names = frameNames([
    { id: 'finance', title: 'Finance', aliases: ['Financial'] },
    { id: 'debt', title: 'Debt', aliases: null },
  ]);

  it('takes the picks by key, then the other titles that are frame topics, each once', () => {
    const topics = resolveNamedTopics(
      { picks: ['T1', 't3', 'T9', 'nonsense'], others: ['finance', 'Debt', 'Leveraged buyout'] },
      candidates,
      names,
      false,
    );
    expect(topics).toEqual([
      { id: 'investment', similarity: NAMED_SIMILARITY },
      { id: 'debt', similarity: NAMED_SIMILARITY },
      { id: 'finance', similarity: NAMED_SIMILARITY },
    ]);
  });

  it('holds a guessed course to a lower similarity and at most a few topics', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, title: `T ${i}`, level: 4, similarity: 0.5 }));
    const topics = resolveNamedTopics({ picks: many.map((_, i) => `T${i + 1}`), others: [] }, many, names, true);
    expect(topics).toHaveLength(TOPICS_PER_COURSE);
    expect(topics.every((t) => t.similarity === GUESSED_SIMILARITY)).toBe(true);
  });
});

describe('the band links', () => {
  it('writes one course link per named topic with the band and its reason', () => {
    const rows = bandLinks(
      [
        {
          course_id: 'c1',
          depth: 'advanced',
          guessed: false,
          topics: [{ id: 'debt', similarity: 0.8 }],
          named_at: '2026-10-16T06:00:00Z',
        },
        // A course gone from the transcript marks nothing.
        { course_id: 'gone', depth: 'intro', guessed: true, topics: [{ id: 'debt', similarity: 0.6 }], named_at: '2026-10-16T06:00:00Z' },
      ],
      [course()],
      2026,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      target_kind: 'topic',
      target_id: 'debt',
      source_kind: 'course',
      source_id: 'c1',
      similarity: 0.8,
      band_low: 1,
      band_high: 4,
      matched_by: null,
      held_reason: null,
    });
    expect(rows[0].weight).toBeCloseTo(0.917, 3);
    expect(rows[0].basis).toMatch(/^from MGT 847/);
  });

  it('gives a tested topic its level in place of the band, and drops one the answer missed', () => {
    const rows = bandLinks(
      [
        {
          course_id: 'c1',
          depth: 'advanced',
          guessed: false,
          topics: [
            { id: 'debt', similarity: 0.8 },
            { id: 'equity', similarity: 0.8 },
            { id: 'finance', similarity: 0.8 },
          ],
          named_at: '2026-10-16T06:00:00Z',
        },
      ],
      [course()],
      2026,
      [
        {
          course_id: 'c1',
          marks: [
            { topic_id: 'debt', level: 3, basis: 'from MGT 847, and your explanation of it: tested at level 3.' },
            { topic_id: 'equity', level: 0, basis: 'missed' },
          ],
        },
      ],
    );
    const byTopic = new Map(rows.map((r) => [r.target_id, r]));
    expect(byTopic.get('debt')).toMatchObject({ band_low: null, band_high: null, tested_level: 3 });
    expect(byTopic.get('debt')?.basis).toMatch(/tested at level 3/);
    expect(byTopic.has('equity')).toBe(false);
    // A topic the answer did not go to keeps its band.
    expect(byTopic.get('finance')).toMatchObject({ band_low: 1, band_high: 4, tested_level: null });
  });
});
