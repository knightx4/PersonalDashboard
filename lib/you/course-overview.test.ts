import { describe, expect, it, vi } from 'vitest';
import {
  courseNoteNeedles,
  courseNotesFilter,
  newerSummaries,
  noteExcerpt,
  overviewNeed,
  overviewText,
  readCourseOverview,
  readFiles,
  readOverviewAnswer,
  storedRecurring,
  type CourseOverview,
} from './course-overview';
import type { CourseFile } from './transcripts';

function file(id: string, week: number | null, read: string | null, readAt = '2026-10-18T10:00:00Z'): CourseFile {
  return {
    id,
    user_id: 'u',
    course_id: 'c',
    kind: week === null ? 'syllabus' : 'slides',
    title: `File ${id}`,
    week,
    position: 0,
    file_name: `${id}.pdf`,
    storage_path: `u/c/${id}.pdf`,
    mime_type: 'application/pdf',
    size_bytes: 1,
    uploaded_at: readAt,
    updated_at: readAt,
    summary: read ? { summary: read, points: [`A point from ${id}.`], model: 'haiku', read_at: readAt } : null,
  };
}

describe('how many files an overview needs', () => {
  it('needs two read files', () => {
    expect(overviewNeed([])).toBe(2);
    expect(overviewNeed([file('a', 1, 'S'), file('b', 2, null)])).toBe(1);
    expect(overviewNeed([file('a', 1, 'S'), file('b', 2, 'T')])).toBe(0);
  });
});

describe('what the model reads', () => {
  it('numbers each read file with its week, kind, summary and points', () => {
    const text = overviewText(readFiles([file('a', null, 'The rules.'), file('b', 2, null), file('c', 3, 'Elasticity.')]));
    expect(text).toBe(
      '[1] Syllabus: File a\nThe rules.\n- A point from a.\n\n[2] Week 3 · Slides: File c\nElasticity.\n- A point from c.',
    );
  });
});

describe('reading the answer', () => {
  const files = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('maps file numbers to ids and keeps only ideas in two files or more', () => {
    const read = readOverviewAnswer(
      {
        about: '  How markets   set prices. ',
        recurring: [
          { idea: 'Opportunity cost', files: [1, 3] },
          { idea: 'Only once', files: [2] },
          { idea: 'Out of range', files: [2, 9] },
          { idea: 'opportunity cost', files: [1, 2] },
          { idea: 'Incentives', files: ['2', 3, 3] },
        ],
      },
      files,
    );
    expect(read).toEqual({
      ok: true,
      about: 'How markets set prices.',
      recurring: [
        { idea: 'Opportunity cost', file_ids: ['a', 'c'] },
        { idea: 'Incentives', file_ids: ['b', 'c'] },
      ],
      fileIds: ['a', 'b', 'c'],
    });
  });

  it('refuses an answer with nothing on what the course was about', () => {
    expect(readOverviewAnswer({ about: ' ', recurring: [] }, files)).toEqual({
      ok: false,
      error: 'Dash could not say what the course was about, so nothing was kept.',
    });
  });
});

describe('one read', () => {
  it('asks nothing under two read files', async () => {
    const ask = vi.fn();
    const read = await readCourseOverview({ courseTitle: 'ECON 101', files: [file('a', 1, 'S'), file('b', 2, null)] }, ask);
    expect(read).toEqual({ ok: false, error: 'Summarise 1 more file first.' });
    expect(ask).not.toHaveBeenCalled();
  });

  it('sends the summaries as text and says how many of the files were read', async () => {
    const ask = vi.fn().mockResolvedValue({ ok: true, input: { about: 'Prices.', recurring: [] } });
    const read = await readCourseOverview(
      { courseTitle: 'ECON 101', files: [file('a', 1, 'S'), file('b', 2, 'T'), file('c', 3, null)] },
      ask,
    );
    expect(read).toMatchObject({ ok: true, about: 'Prices.', fileIds: ['a', 'b'] });
    expect(ask.mock.calls[0][0].kind).toBe('text');
    expect(ask.mock.calls[0][1]).toContain('Summaries exist for 2 of its 3 files');
  });
});

describe('summaries newer than the overview', () => {
  const overview: CourseOverview = {
    about: 'x',
    recurring: [],
    file_ids: ['a', 'b'],
    model: 'haiku',
    read_at: '2026-10-18T12:00:00Z',
  };

  it('counts files read since, and files read again after it', () => {
    expect(
      newerSummaries(
        [file('a', 1, 'S'), file('b', 2, 'T', '2026-10-18T13:00:00Z'), file('c', 3, 'U'), file('d', 4, null)],
        overview,
      ),
    ).toBe(2);
  });
});

describe('a stored recurring list', () => {
  it('keeps well-formed ideas only', () => {
    expect(storedRecurring([{ idea: 'A', file_ids: ['x', 3] }, { idea: '' }, null, 'b'])).toEqual([
      { idea: 'A', file_ids: ['x'] },
    ]);
    expect(storedRecurring(null)).toEqual([]);
  });
});

describe("the person's notes about a course", () => {
  it('looks for the code with and without its space, and a title of two words or more', () => {
    expect(courseNoteNeedles({ code: 'ECON 101', title: 'Principles of Microeconomics' })).toEqual([
      'ECON 101',
      'ECON101',
      'Principles of Microeconomics',
    ]);
  });

  it('leaves out a one-word or short title and a missing code', () => {
    expect(courseNoteNeedles({ code: 'MGT 411', title: 'Customer' })).toEqual(['MGT 411', 'MGT411']);
    expect(courseNoteNeedles({ code: null, title: 'Calculus I' })).toEqual([]);
  });

  it('drops the characters a PostgREST filter reads as syntax', () => {
    expect(courseNoteNeedles({ code: null, title: 'Data, (Big) & 100%: done' })).toEqual(['Data Big & 100 done']);
    expect(courseNotesFilter(['ECON 101'])).toBe('title.ilike."*ECON 101*",body.ilike."*ECON 101*"');
    expect(courseNotesFilter([])).toBeNull();
  });

  it('quotes the line around the first mention', () => {
    const body = `${'a'.repeat(200)} I liked ECON 101 more than I expected ${'b'.repeat(200)}`;
    const excerpt = noteExcerpt(body, ['ECON101', 'econ 101'], 40);
    expect(excerpt).toMatch(/^….*ECON 101.*…$/);
    expect(noteExcerpt('Nothing here.', ['ECON 101'])).toBeNull();
  });
});
