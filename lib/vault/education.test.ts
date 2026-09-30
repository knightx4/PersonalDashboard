import { describe, expect, it } from 'vitest';
import {
  courseFieldName,
  courseHref,
  groupCourses,
  ownsTranscriptPath,
  parseCourse,
  parseCourseRows,
  parseRowList,
  transcriptContentType,
  transcriptFileHref,
} from './education';
import { transcriptStoragePath, type Course, type Transcript } from './transcripts';

const USER = '0b6c1f1e-2b8a-4c55-9f53-1d2a3b4c5d6e';
const UUID = '5f0c7a2e-8d1b-4e3f-a2c4-9b8d7e6f5a41';

function transcript(id: string, school: string, uploaded_at: string): Transcript {
  return {
    id,
    user_id: USER,
    school,
    file_name: `${id}.pdf`,
    storage_path: `${USER}/${UUID}-${id}.pdf`,
    mime_type: 'application/pdf',
    size_bytes: 1000,
    uploaded_at,
    updated_at: uploaded_at,
  };
}

let n = 0;
function course(transcript_id: string, school: string, term: string | null, year: number | null, position: number, title = `Course ${++n}`): Course {
  return {
    id: `c${n}-${position}`,
    user_id: USER,
    transcript_id,
    school,
    code: null,
    title,
    term,
    year,
    credits: 3,
    grade: 'A',
    position,
    created_at: '',
    updated_at: '',
  };
}

describe('transcript files', () => {
  it('keeps only the types the bucket accepts', () => {
    expect(transcriptContentType('a.pdf')).toBe('application/pdf');
    expect(transcriptContentType('scan.JPG')).toBe('image/jpeg');
    expect(transcriptContentType('t.docx')).toMatch(/wordprocessingml/);
    expect(transcriptContentType('Pasted transcript.txt')).toBe('text/plain');
    expect(transcriptContentType('grades.csv')).toBeNull();
    expect(transcriptContentType('page.html')).toBeNull();
    expect(transcriptContentType('photo.heic')).toBeNull();
  });

  it('owns the paths transcriptStoragePath writes, and only in its own folder', () => {
    const path = transcriptStoragePath(USER, 'My Transcript (2019).pdf', UUID);
    expect(ownsTranscriptPath(USER, path)).toBe(true);
    expect(ownsTranscriptPath('someone-else', path)).toBe(false);
    expect(ownsTranscriptPath(USER, `${USER}/../x.pdf`)).toBe(false);
    expect(ownsTranscriptPath(USER, `${USER}/${UUID}-a/b.pdf`)).toBe(false);
  });

  it('links a course to its row and a transcript to its file', () => {
    expect(courseHref('abc')).toBe('/vault/education#course-abc');
    expect(transcriptFileHref('abc')).toBe('/vault/education/file/abc');
  });
});

describe('the checked course list', () => {
  const form = (values: Record<string, string>) => (name: string) => values[name] ?? null;

  it('reads the kept rows in order, with the transcript school for a blank one', () => {
    const values = {
      [courseFieldName(0, 'title')]: ' Calculus  I ',
      [courseFieldName(0, 'code')]: 'MATH 101',
      [courseFieldName(0, 'credits')]: '4',
      [courseFieldName(0, 'grade')]: 'A-',
      [courseFieldName(0, 'term')]: 'Fall 2019',
      [courseFieldName(0, 'year')]: '2019',
      [courseFieldName(2, 'title')]: 'Intro to Film',
      [courseFieldName(2, 'school')]: 'City College',
      [courseFieldName(1, 'title')]: 'Left out',
    };
    const read = parseCourseRows(form(values), [0, 2], 'State University');
    expect(read).toEqual({
      ok: true,
      courses: [
        { school: 'State University', code: 'MATH 101', title: 'Calculus I', term: 'Fall 2019', year: 2019, credits: 4, grade: 'A-' },
        { school: 'City College', code: null, title: 'Intro to Film', term: null, year: null, credits: null, grade: null },
      ],
    });
  });

  it('names the row and field of a mistake', () => {
    const values = { [courseFieldName(3, 'title')]: 'Ok', [courseFieldName(4, 'title')]: '  ' };
    expect(parseCourseRows(form(values), [3, 4], 'S')).toMatchObject({ ok: false, row: 4, field: 'title' });
    const bad = { [courseFieldName(0, 'title')]: 'X', [courseFieldName(0, 'credits')]: 'three' };
    expect(parseCourseRows(form(bad), [0], 'S')).toMatchObject({ ok: false, row: 0, field: 'credits' });
    const year = { [courseFieldName(0, 'title')]: 'X', [courseFieldName(0, 'year')]: '19' };
    expect(parseCourseRows(form(year), [0], 'S')).toMatchObject({ ok: false, field: 'year' });
  });

  it('asks for at least one course', () => {
    expect(parseCourseRows(form({}), [], 'S')).toMatchObject({ ok: false });
  });

  it('parses one saved course for the edit form', () => {
    const read = parseCourse((f) => ({ title: 'Ethics', credits: '2.5', school: '' })[f as string] ?? '', 'Kept');
    expect(read).toEqual({
      ok: true,
      course: { school: 'Kept', code: null, title: 'Ethics', term: null, year: null, credits: 2.5, grade: null },
    });
  });

  it('reads the row list and drops junk', () => {
    expect(parseRowList('0, 2,2,x,-1,5')).toEqual([0, 2, 5]);
    expect(parseRowList(null)).toEqual([]);
  });
});

describe('groupCourses', () => {
  it('groups by school, then by term with the newest first', () => {
    const a = transcript('t1', 'State University', '2026-09-01T00:00:00Z');
    const courses = [
      course('t1', 'State University', 'Fall 2019', 2019, 0, 'First'),
      course('t1', 'State University', 'Spring 2020', 2020, 1, 'Second'),
      course('t1', 'State University', 'Fall 2020', 2020, 2, 'Third'),
      course('t1', 'State University', 'Fall 2020', 2020, 3, 'Fourth'),
      course('t1', 'City College', null, null, 4, 'Transfer'),
    ];
    const groups = groupCourses([a], courses);
    expect(groups.map((g) => g.school)).toEqual(['City College', 'State University']);
    const state = groups[1];
    expect(state.terms.map((t) => t.term)).toEqual(['Fall 2020', 'Spring 2020', 'Fall 2019']);
    expect(state.terms[0].courses.map((c) => c.title)).toEqual(['Third', 'Fourth']);
    expect(state.transcripts.map((t) => t.id)).toEqual(['t1']);
    expect(groups[0].terms).toEqual([{ term: null, year: null, courses: [courses[4]] }]);
    expect(groups[0].transcripts).toEqual([]);
  });

  it('puts courses with no term last and keeps a school with a transcript but no courses', () => {
    const t = transcript('t2', 'Old School', '2026-01-01T00:00:00Z');
    const courses = [
      course('t2', 'Elsewhere', null, null, 0, 'No term'),
      course('t2', 'Elsewhere', 'Semester 1 2018', 2018, 1, 'Sem one'),
      course('t2', 'Elsewhere', 'Semester 2 2018', 2018, 2, 'Sem two'),
    ];
    const groups = groupCourses([t], courses);
    expect(groups.map((g) => g.school)).toEqual(['Elsewhere', 'Old School']);
    expect(groups[0].terms.map((x) => x.term)).toEqual(['Semester 2 2018', 'Semester 1 2018', null]);
    expect(groups[1]).toEqual({ school: 'Old School', terms: [], transcripts: [t] });
  });

  it('treats a school written with different case as one school', () => {
    const t = transcript('t3', 'state university', '2026-01-01T00:00:00Z');
    const groups = groupCourses([t], [course('t3', 'State University', 'Fall 2019', 2019, 0)]);
    expect(groups).toHaveLength(1);
  });
});
