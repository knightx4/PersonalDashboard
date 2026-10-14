import { describe, expect, it } from 'vitest';
import {
  ageFactor,
  COURSE_TEXT_MAX_CHARS,
  courseBasis,
  courseLinks,
  courseText,
  courseWeight,
  gradeFactor,
  isTitleOnly,
  type CourseSource,
} from './courses';

const course = (over: Partial<CourseSource> = {}): CourseSource => ({
  course_id: 'c1',
  school: 'Yale University',
  code: 'MGT 541',
  title: 'Corporate Finance',
  term: 'Spring 2026',
  year: 2026,
  grade: 'A',
  notes: [],
  catalogue_description: null,
  ...over,
});

describe('how much a grade counts', () => {
  it('counts an A or an honours grade fully', () => {
    for (const grade of ['A', 'A-', 'a+', 'H', 'HH', 'TA']) expect(gradeFactor(grade)).toBe(1);
  });

  it('counts a credit or a pass less than an A', () => {
    for (const grade of ['CR', 'P']) {
      expect(gradeFactor(grade)).toBeGreaterThan(0);
      expect(gradeFactor(grade)).toBeLessThan(1);
    }
  });

  it('counts a course in progress, waived, failed or ungraded not at all', () => {
    for (const grade of ['PR', 'WVD', 'W', 'F', 'I', '', null]) expect(gradeFactor(grade)).toBe(0);
  });
});

describe('how much a course is worth with age', () => {
  it('counts a 2017 course less than a 2025 one', () => {
    expect(ageFactor(2017, 2026)).toBeLessThan(ageFactor(2025, 2026));
    expect(ageFactor(2026, 2026)).toBe(1);
  });

  it('halves every eight years and never drops below the floor', () => {
    expect(ageFactor(2018, 2026)).toBeCloseTo(0.5);
    expect(ageFactor(1990, 2026)).toBe(0.3);
  });

  it('weighs a link by grade and age together', () => {
    expect(courseWeight({ grade: 'A', year: 2025 }, 2026)).toBeGreaterThan(
      courseWeight({ grade: 'A', year: 2017 }, 2026),
    );
    expect(courseWeight({ grade: 'CR', year: 2025 }, 2026)).toBeLessThan(
      courseWeight({ grade: 'A', year: 2025 }, 2026),
    );
    expect(courseWeight({ grade: 'PR', year: 2026 }, 2026)).toBe(0);
  });
});

describe("a course's text", () => {
  it('opens with the course and puts the summary before the other notes', () => {
    const text = courseText(course({ notes: ['# Summary', 'Lecture notes'] }));
    expect(text.startsWith('MGT 541 Corporate Finance (Yale University, Spring 2026)')).toBe(true);
    expect(text.indexOf('# Summary')).toBeLessThan(text.indexOf('Lecture notes'));
  });

  it('is cut at the limit', () => {
    expect(courseText(course({ notes: ['x'.repeat(COURSE_TEXT_MAX_CHARS * 2)] })).length).toBe(
      COURSE_TEXT_MAX_CHARS,
    );
  });

  it('is title only with neither notes nor a catalogue description', () => {
    expect(isTitleOnly(course())).toBe(true);
    expect(isTitleOnly(course({ notes: ['n'] }))).toBe(false);
    expect(isTitleOnly(course({ catalogue_description: 'What the course covers.' }))).toBe(false);
  });
});

describe('the links a match makes', () => {
  it('says which course, the grade and the year', () => {
    expect(courseBasis(course({ grade: 'A', year: 2025 }))).toBe(
      'from MGT 541 Corporate Finance, A, 2025',
    );
    expect(courseBasis(course({ code: null, grade: null, year: null }))).toBe(
      'from Corporate Finance',
    );
  });

  it('makes none for a course that counts nothing or is gone', () => {
    const rows = courseLinks(
      [
        { course_id: 'c1', concept_id: 'i1', similarity: 0.72 },
        { course_id: 'c2', concept_id: 'i1', similarity: 0.8 },
        { course_id: 'gone', concept_id: 'i2', similarity: 0.9 },
      ],
      [course(), course({ course_id: 'c2', grade: 'PR' })],
      2026,
    );
    expect(rows).toEqual([
      {
        target_kind: 'idea',
        target_id: 'i1',
        source_kind: 'course',
        source_id: 'c1',
        similarity: 0.72,
        weight: 1,
        basis: 'from MGT 541 Corporate Finance, A, 2026',
      },
    ]);
  });
});
