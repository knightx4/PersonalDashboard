import { describe, expect, it } from 'vitest';
import { conceptsAfterRead, readLine, readsByCourse } from './course-reads';

const ECON = { id: 's-econ', name: 'Economics' };

describe('readsByCourse', () => {
  it('names the track each course went into, and none for a removed track', () => {
    const reads = readsByCourse(
      [
        { course_id: 'c1', subject_id: 's-econ', concepts_added: 6, read_at: '2026-10-01T10:00:00Z' },
        { course_id: 'c2', subject_id: null, concepts_added: 3, read_at: '2026-10-01T11:00:00Z' },
        { course_id: 'c3', subject_id: 's-gone', concepts_added: 2, read_at: '2026-10-01T12:00:00Z' },
      ],
      [ECON],
    );
    expect(reads.c1.subject).toEqual(ECON);
    expect(reads.c1.conceptsAdded).toBe(6);
    expect(reads.c2.subject).toBeNull();
    expect(reads.c3.subject).toBeNull();
    expect(reads.c4).toBeUndefined();
  });
});

describe('conceptsAfterRead', () => {
  it('counts from zero on a first read', () => {
    expect(conceptsAfterRead(null, 's-econ', 5)).toBe(5);
  });

  it('adds to the count when the course is read again into the same track', () => {
    expect(conceptsAfterRead({ subject_id: 's-econ', concepts_added: 5 }, 's-econ', 2)).toBe(7);
  });

  it('starts again when the course goes into a different track', () => {
    expect(conceptsAfterRead({ subject_id: 's-econ', concepts_added: 5 }, 's-maths', 2)).toBe(2);
    expect(conceptsAfterRead({ subject_id: null, concepts_added: 5 }, 's-maths', 2)).toBe(2);
  });
});

describe('readLine', () => {
  it('says where the course went and how many ideas it left known', () => {
    expect(readLine({ subject: ECON, conceptsAdded: 1, readAt: '' })).toBe(
      'Read into Economics, 1 idea known',
    );
    expect(readLine({ subject: null, conceptsAdded: 4, readAt: '' })).toBe(
      'Read, 4 ideas known; that track has since been removed',
    );
  });
});
