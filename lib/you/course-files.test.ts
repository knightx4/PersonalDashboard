import { describe, expect, it } from 'vitest';
import {
  courseFileContentType,
  courseFileTitle,
  groupCourseFiles,
  ownsCourseFilePath,
  parseWeek,
  refuseCourseFiles,
} from '@/lib/you/course-files';
import { COURSE_FILE_MAX_BYTES, type CourseFile, type CourseFileKind } from '@/lib/you/transcripts';

const U = '00000000-0000-4000-8000-000000000001';
const C = '00000000-0000-4000-8000-0000000000c1';

function file(id: string, kind: CourseFileKind, week: number | null, position = 0): CourseFile {
  return {
    id,
    user_id: U,
    course_id: C,
    kind,
    title: id,
    week,
    position,
    file_name: `${id}.pdf`,
    storage_path: `${U}/${C}/${id}`,
    mime_type: 'application/pdf',
    size_bytes: 1000,
    uploaded_at: '2026-10-18T00:00:00Z',
    updated_at: '2026-10-18T00:00:00Z',
  };
}

describe('courseFileContentType', () => {
  it('takes PowerPoint and the transcript types, and refuses the rest', () => {
    expect(courseFileContentType('Week 3.PPTX')).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    expect(courseFileContentType('reading.pdf')).toBe('application/pdf');
    expect(courseFileContentType('notes.txt')).toBe('text/plain');
    expect(courseFileContentType('slides.key')).toBeNull();
    expect(courseFileContentType('grades.csv')).toBeNull();
  });
});

describe('refuseCourseFiles', () => {
  it('says why a type, a size or a file past the twentieth is refused', () => {
    const reasons = refuseCourseFiles(
      [
        { name: 'a.pdf', size: 10 },
        { name: 'b.key', size: 10 },
        { name: 'c.pdf', size: COURSE_FILE_MAX_BYTES + 1 },
        { name: 'd.pdf', size: 10 },
        { name: 'e.pdf', size: 10 },
      ],
      18,
    );
    expect(reasons[0]).toBeNull();
    expect(reasons[1]).toMatch(/Not a file the course can keep/);
    expect(reasons[2]).toMatch(/Over 20 MB/);
    expect(reasons[3]).toBeNull();
    expect(reasons[4]).toBe('A course holds at most 20 files.');
  });
});

describe('ownsCourseFilePath', () => {
  it("accepts only a fresh name in this account's folder for this course", () => {
    const name = '5f0c7a2e-8d1b-4e3f-a2c4-9b8d7e6f5a41-Week_1.pptx';
    expect(ownsCourseFilePath(U, C, `${U}/${C}/${name}`)).toBe(true);
    expect(ownsCourseFilePath(U, 'other', `${U}/${C}/${name}`)).toBe(false);
    expect(ownsCourseFilePath('other', C, `${U}/${C}/${name}`)).toBe(false);
    expect(ownsCourseFilePath(U, C, `${U}/${C}/../x`)).toBe(false);
  });
});

describe('parseWeek', () => {
  it('reads blank as no week and refuses anything past 60', () => {
    expect(parseWeek('')).toEqual({ ok: true, week: null });
    expect(parseWeek(' 7 ')).toEqual({ ok: true, week: 7 });
    expect(parseWeek('61')).toEqual({ ok: false });
    expect(parseWeek('two')).toEqual({ ok: false });
  });
});

describe('courseFileTitle', () => {
  it('drops the extension and the underscores', () => {
    expect(courseFileTitle('Week_03_Elasticity.pptx')).toBe('Week 03 Elasticity');
  });
});

describe('groupCourseFiles', () => {
  it('puts the syllabus first, then each week with its lectures before its readings, then the files with no week', () => {
    const groups = groupCourseFiles([
      file('r2', 'reading', 3),
      file('n2', 'lecture_notes', 2),
      file('s1', 'slides', 1),
      file('loose', 'slides', null),
      file('syl', 'syllabus', null),
      file('s2', 'slides', 2, 0),
      file('r1', 'reading', 1),
    ]);
    expect(groups.map((g) => [g.label, g.files.map((f) => f.id)])).toEqual([
      ['Syllabus', ['syl']],
      ['Week 1', ['s1', 'r1']],
      ['Week 2', ['n2', 's2']],
      ['Week 3', ['r2']],
      ['No week', ['loose']],
    ]);
  });

  it('leaves out empty groups', () => {
    expect(groupCourseFiles([])).toEqual([]);
  });
});
