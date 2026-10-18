import { describe, expect, it } from 'vitest';
import {
  COURSE_FILES_BUCKET,
  courseFileStoragePath,
  deleteCourse,
  deleteCourseFile,
  deleteTranscript,
  isCourseFileMimeType,
  transcriptStoragePath,
  TRANSCRIPTS_BUCKET,
  type TranscriptStore,
} from '@/lib/you/transcripts';

describe('transcriptStoragePath', () => {
  it('puts the file in the account folder behind a fresh id', () => {
    expect(transcriptStoragePath('user-1', 'Fall 2019 (final).pdf', 'abc')).toBe(
      'user-1/abc-Fall_2019_final_.pdf',
    );
  });

  it('refuses an empty user id, which would name the bucket root', () => {
    expect(() => transcriptStoragePath('', 'a.pdf', 'abc')).toThrow();
  });
});

describe('courseFileStoragePath', () => {
  it("puts the file in the course's folder inside the account folder", () => {
    expect(courseFileStoragePath('user-1', 'course-1', 'Week 3 slides.pptx', 'abc')).toBe(
      'user-1/course-1/abc-Week_3_slides.pptx',
    );
  });

  it('refuses an empty user or course id', () => {
    expect(() => courseFileStoragePath('', 'course-1', 'a.pdf', 'abc')).toThrow();
    expect(() => courseFileStoragePath('user-1', '', 'a.pdf', 'abc')).toThrow();
  });

  it('takes PowerPoint, which a transcript does not', () => {
    expect(isCourseFileMimeType('application/vnd.openxmlformats-officedocument.presentationml.presentation')).toBe(true);
    expect(isCourseFileMimeType('image/svg+xml')).toBe(false);
  });
});

type Row = Record<string, string>;
type Tables = { transcripts: Row[]; courses: Row[]; course_files: Row[] };

/**
 * An in-memory client for the three tables. A delete cascades as the
 * database does: a transcript takes its courses, a course its files.
 */
function fakeStore(tables: Tables) {
  const removed: Array<{ bucket: string; paths: string[] }> = [];

  const cascade = (table: keyof Tables, gone: Row[]) => {
    if (table === 'transcripts') {
      const courses = tables.courses.filter((c) => gone.some((t) => t.id === c.transcript_id));
      tables.courses = tables.courses.filter((c) => !courses.includes(c));
      cascade('courses', courses);
    }
    if (table === 'courses') {
      tables.course_files = tables.course_files.filter((f) => !gone.some((c) => c.id === f.course_id));
    }
  };

  const query = (table: keyof Tables, mode: 'select' | 'delete') => {
    const filters: Array<(row: Row) => boolean> = [];
    let columns = '*';
    const run = () => {
      const hit = tables[table].filter((row) => filters.every((f) => f(row)));
      if (mode === 'delete') {
        tables[table] = tables[table].filter((row) => !hit.includes(row));
        cascade(table, hit);
      }
      const data = hit.map((row) => (columns === '*' ? row : { [columns]: row[columns] }));
      return { data, error: null };
    };
    const chain = {
      eq: (column: string, value: string) => {
        filters.push((row) => row[column] === value);
        return chain;
      },
      in: (column: string, values: string[]) => {
        filters.push((row) => values.includes(row[column]));
        return chain;
      },
      select: (cols: string) => {
        columns = cols;
        return chain;
      },
      then: <A, B = never>(
        ok?: ((value: ReturnType<typeof run>) => A | PromiseLike<A>) | null,
        bad?: ((reason: unknown) => B | PromiseLike<B>) | null,
      ) => Promise.resolve().then(run).then(ok, bad),
    };
    return chain;
  };

  const client: TranscriptStore = {
    from: (table) => ({
      select: (cols) => query(table, 'select').select(cols),
      delete: () => query(table, 'delete'),
    }),
    storage: {
      from: (bucket) => ({
        remove: async (paths) => {
          removed.push({ bucket, paths });
          return { error: null };
        },
      }),
    },
  };
  return { client, tables, removed };
}

function seed(): Tables {
  return {
    transcripts: [{ id: 't1', user_id: 'u1', storage_path: 'u1/x-a.pdf' }],
    courses: [
      { id: 'c1', user_id: 'u1', transcript_id: 't1' },
      { id: 'c2', user_id: 'u1', transcript_id: 't1' },
    ],
    course_files: [
      { id: 'f1', user_id: 'u1', course_id: 'c1', storage_path: 'u1/c1/f1-syllabus.pdf' },
      { id: 'f2', user_id: 'u1', course_id: 'c1', storage_path: 'u1/c1/f2-week-1.pptx' },
      { id: 'f3', user_id: 'u1', course_id: 'c2', storage_path: 'u1/c2/f3-reading.pdf' },
    ],
  };
}

describe('deleteTranscript', () => {
  it('removes the row, then its file and every file kept under its courses', async () => {
    const store = fakeStore(seed());
    expect(await deleteTranscript(store.client, 'u1', 't1')).toBe(true);
    expect(store.tables).toEqual({ transcripts: [], courses: [], course_files: [] });
    expect(store.removed).toEqual([
      { bucket: TRANSCRIPTS_BUCKET, paths: ['u1/x-a.pdf'] },
      {
        bucket: COURSE_FILES_BUCKET,
        paths: ['u1/c1/f1-syllabus.pdf', 'u1/c1/f2-week-1.pptx', 'u1/c2/f3-reading.pdf'],
      },
    ]);
  });

  it('removes only the transcript file when its courses hold none', async () => {
    const store = fakeStore({ ...seed(), course_files: [] });
    expect(await deleteTranscript(store.client, 'u1', 't1')).toBe(true);
    expect(store.removed).toEqual([{ bucket: TRANSCRIPTS_BUCKET, paths: ['u1/x-a.pdf'] }]);
  });

  it("touches nothing for another account's transcript", async () => {
    const store = fakeStore(seed());
    expect(await deleteTranscript(store.client, 'u2', 't1')).toBe(false);
    expect(store.tables.transcripts).toHaveLength(1);
    expect(store.tables.course_files).toHaveLength(3);
    expect(store.removed).toEqual([]);
  });
});

describe('deleteCourse', () => {
  it("removes the course and its files, and leaves the transcript's other courses", async () => {
    const store = fakeStore(seed());
    expect(await deleteCourse(store.client, 'u1', 'c1')).toBe(true);
    expect(store.tables.courses.map((c) => c.id)).toEqual(['c2']);
    expect(store.tables.course_files.map((f) => f.id)).toEqual(['f3']);
    expect(store.removed).toEqual([
      { bucket: COURSE_FILES_BUCKET, paths: ['u1/c1/f1-syllabus.pdf', 'u1/c1/f2-week-1.pptx'] },
    ]);
  });

  it('removes nothing from storage for a course with no files', async () => {
    const store = fakeStore(seed());
    await deleteCourse(store.client, 'u1', 'c1');
    store.removed.length = 0;
    expect(await deleteCourse(store.client, 'u1', 'c1')).toBe(false);
    const empty = fakeStore({ ...seed(), course_files: [] });
    expect(await deleteCourse(empty.client, 'u1', 'c2')).toBe(true);
    expect(empty.removed).toEqual([]);
  });

  it("touches nothing for another account's course", async () => {
    const store = fakeStore(seed());
    expect(await deleteCourse(store.client, 'u2', 'c1')).toBe(false);
    expect(store.tables.courses).toHaveLength(2);
    expect(store.tables.course_files).toHaveLength(3);
    expect(store.removed).toEqual([]);
  });
});

describe('deleteCourseFile', () => {
  it('removes the one row and its stored file, leaving the course and its other files', async () => {
    const store = fakeStore(seed());
    expect(await deleteCourseFile(store.client, 'u1', 'f2')).toBe(true);
    expect(store.tables.courses).toHaveLength(2);
    expect(store.tables.course_files.map((f) => f.id)).toEqual(['f1', 'f3']);
    expect(store.removed).toEqual([{ bucket: COURSE_FILES_BUCKET, paths: ['u1/c1/f2-week-1.pptx'] }]);
  });

  it("touches nothing for another account's file", async () => {
    const store = fakeStore(seed());
    expect(await deleteCourseFile(store.client, 'u2', 'f2')).toBe(false);
    expect(store.tables.course_files).toHaveLength(3);
    expect(store.removed).toEqual([]);
  });
});
