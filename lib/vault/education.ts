/**
 * The vault's Education tab (plan #1308, under #1304): the rules the page and
 * its actions share, kept pure so the tests can reach them.
 *
 * - Which files it takes, and the content type each is kept under.
 * - Where a course or a transcript opens, for links from elsewhere.
 * - Reading the checked course list back out of the form.
 * - Grouping saved courses by school and then by term, newest term first.
 */

import { z } from 'zod';
import { documentContentType } from '@/lib/goals/extract';
import {
  TRANSCRIPT_MAX_BYTES,
  isTranscriptMimeType,
  type Course,
  type Transcript,
  type TranscriptMimeType,
} from '@/lib/vault/transcripts';

export const EDUCATION_HREF = '/vault/education';

/** The file picker's accept list: the bucket's types, by extension. */
export const TRANSCRIPT_ACCEPT = '.pdf,.png,.jpg,.jpeg,.gif,.webp,.docx,.txt';

/** The name pasted text is kept under, so the reader takes it as text. */
export const PASTED_FILE_NAME = 'Pasted transcript.txt';

/** The anchor a course row carries on the Education tab. */
export function courseAnchor(id: string): string {
  return `course-${id}`;
}

/** The anchor a transcript's line carries on the Education tab. */
export function transcriptAnchor(id: string): string {
  return `transcript-${id}`;
}

/** Where one course opens: its row on the Education tab. */
export function courseHref(id: string): string {
  return `${EDUCATION_HREF}#${courseAnchor(id)}`;
}

/** Where one transcript opens: its line on the Education tab. */
export function transcriptHref(id: string): string {
  return `${EDUCATION_HREF}#${transcriptAnchor(id)}`;
}

/** Where a transcript's original file opens, through a one-minute signed link. */
export function transcriptFileHref(id: string): string {
  return `${EDUCATION_HREF}/file/${id}`;
}

/**
 * The content type a transcript file is kept under, from its name, or null
 * for a file the bucket refuses. The goals reader's rule, narrowed to the
 * bucket's types: it also reads .csv and .html, which this bucket does not
 * keep.
 */
export function transcriptContentType(name: string): TranscriptMimeType | null {
  const type = documentContentType(name);
  return type && isTranscriptMimeType(type) ? type : null;
}

/**
 * Whether a storage path is one of this account's uploads:
 * `<user id>/<uuid>-<safe name>`, as transcriptStoragePath writes it.
 */
export function ownsTranscriptPath(userId: string, path: string): boolean {
  if (!userId || !path.startsWith(`${userId}/`)) return false;
  return /^[0-9a-f-]{36}-[A-Za-z0-9._-]{1,120}$/.test(path.slice(userId.length + 1));
}

// -- The checked course list -------------------------------------------------

const optional = (max: number) =>
  z
    .string()
    .transform((value) => value.replace(/\s+/g, ' ').trim())
    .pipe(z.string().max(max, `Keep it to ${max} characters.`))
    .transform((value) => (value === '' ? null : value));

const required = (max: number, blank: string) =>
  z
    .string()
    .transform((value) => value.replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(1, blank).max(max, `Keep it to ${max} characters.`));

const yearField = z
  .string()
  .trim()
  .transform((value, ctx) => {
    if (value === '') return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1900 || n > 2200) {
      ctx.addIssue({ code: 'custom', message: 'A year such as 2019.' });
      return z.NEVER;
    }
    return n;
  });

const creditsField = z
  .string()
  .trim()
  .transform((value, ctx) => {
    if (value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n >= 10_000) {
      ctx.addIssue({ code: 'custom', message: 'A number of credits such as 3 or 4.5.' });
      return z.NEVER;
    }
    return Math.round(n * 100) / 100;
  });

export const schoolField = required(200, 'Say which school this is from.');

/** One course as the form sends it. School is optional: blank means the transcript's. */
export const courseFields = z.object({
  school: optional(200),
  code: optional(50),
  title: required(300, 'Every course needs a title.'),
  term: optional(50),
  year: yearField,
  credits: creditsField,
  grade: optional(20),
});

export type CourseFields = {
  school: string;
  code: string | null;
  title: string;
  term: string | null;
  year: number | null;
  credits: number | null;
  grade: string | null;
};

export const COURSE_FIELD_NAMES = ['school', 'code', 'title', 'term', 'year', 'credits', 'grade'] as const;

/** The form name of one field of one row of the check-before-saving list. */
export function courseFieldName(row: number, field: (typeof COURSE_FIELD_NAMES)[number]): string {
  return `course.${row}.${field}`;
}

export type ParsedCourses =
  | { ok: true; courses: CourseFields[] }
  | { ok: false; error: string; row?: number; field?: string };

/**
 * Read one course's fields from a form: the rows of the check list, or the
 * edit form on a saved course. A blank school falls back to `school`.
 */
export function parseCourse(
  get: (field: (typeof COURSE_FIELD_NAMES)[number]) => string,
  school: string,
): { ok: true; course: CourseFields } | { ok: false; error: string; field?: string } {
  const parsed = courseFields.safeParse(
    Object.fromEntries(COURSE_FIELD_NAMES.map((field) => [field, get(field)])),
  );
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? 'That course cannot be saved.', field: issue?.path[0]?.toString() };
  }
  return { ok: true, course: { ...parsed.data, school: parsed.data.school ?? school } };
}

/**
 * Read the checked list back: the rows named in `rows`, in that order, each
 * from its `course.<row>.<field>` inputs. At least one course is needed.
 */
export function parseCourseRows(
  get: (name: string) => string | null,
  rows: number[],
  school: string,
): ParsedCourses {
  if (rows.length === 0) return { ok: false, error: 'Keep at least one course, or discard the transcript.' };
  const courses: CourseFields[] = [];
  for (const row of rows) {
    const read = parseCourse((field) => get(courseFieldName(row, field)) ?? '', school);
    if (!read.ok) return { ...read, row };
    courses.push(read.course);
  }
  return { ok: true, courses };
}

/** `"0,2,5"` into row numbers; anything else is dropped. */
export function parseRowList(value: string | null): number[] {
  if (!value) return [];
  const rows = value
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n < 1000);
  return [...new Set(rows)];
}

/** Whether a size reported for an upload is one the table accepts. */
export function isTranscriptSize(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= TRANSCRIPT_MAX_BYTES;
}

// -- Grouping ---------------------------------------------------------------

export type TermGroup = {
  /** The term as written, or null for courses with none. */
  term: string | null;
  year: number | null;
  courses: Course[];
};

export type SchoolGroup = {
  school: string;
  terms: TermGroup[];
  /** The transcripts this school issued, newest upload first. */
  transcripts: Transcript[];
};

/**
 * Where a season falls in its year, for ordering terms of the same year.
 * Winter comes first because "Winter 2020" is the term that starts in
 * January 2020; autumn last.
 */
function seasonRank(term: string): number {
  const t = term.toLowerCase();
  if (/\bwinter\b|\bjanuary\b|\bhilary\b|\blent\b/.test(t)) return 0;
  if (/\bspring\b|\beaster\b|\btrinity\b/.test(t)) return 1;
  if (/\bsummer\b/.test(t)) return 2;
  if (/\bfall\b|\bautumn\b|\bmichaelmas\b/.test(t)) return 3;
  const numbered = t.match(/\b(?:semester|sem|term|quarter|trimester|s|t|q)\s*([1-4])\b/);
  return numbered ? Number(numbered[1]) - 1 : -1;
}

const schoolKey = (school: string) => school.trim().toLowerCase();

/**
 * Courses by school, alphabetically, then by term, newest first: by year,
 * then by season within the year, then by where the term came on the
 * transcript. Courses with no term go last under their school. Within a term
 * courses keep the transcript's order. A school that issued a transcript but
 * holds no course (every course on it was transfer credit) still gets a group,
 * so its transcript can be opened and deleted.
 */
export function groupCourses(transcripts: Transcript[], courses: Course[]): SchoolGroup[] {
  const uploadedAt = new Map(transcripts.map((t) => [t.id, t.uploaded_at]));
  const schools = new Map<string, { school: string; courses: Course[]; transcripts: Transcript[] }>();
  const schoolFor = (name: string) => {
    const key = schoolKey(name);
    let group = schools.get(key);
    if (!group) {
      group = { school: name.trim(), courses: [], transcripts: [] };
      schools.set(key, group);
    }
    return group;
  };

  for (const course of courses) schoolFor(course.school).courses.push(course);
  for (const transcript of transcripts) schoolFor(transcript.school).transcripts.push(transcript);

  const onTranscript = (a: Course, b: Course) => {
    if (a.transcript_id !== b.transcript_id) {
      return (uploadedAt.get(a.transcript_id) ?? '').localeCompare(uploadedAt.get(b.transcript_id) ?? '');
    }
    return a.position - b.position;
  };

  return [...schools.values()]
    .sort((a, b) => a.school.localeCompare(b.school, 'en', { sensitivity: 'base' }))
    .map((group) => {
      const terms = new Map<string, TermGroup & { first: number }>();
      for (const course of [...group.courses].sort(onTranscript)) {
        const key = course.term ? `${course.term.toLowerCase()}|${course.year ?? ''}` : '';
        let term = terms.get(key);
        if (!term) {
          term = { term: course.term, year: course.year, courses: [], first: course.position };
          terms.set(key, term);
        }
        term.courses.push(course);
      }
      const ordered = [...terms.values()].sort((a, b) => {
        if (!a.term !== !b.term) return a.term ? -1 : 1;
        if ((a.year ?? -1) !== (b.year ?? -1)) return (b.year ?? -1) - (a.year ?? -1);
        const season = seasonRank(b.term ?? '') - seasonRank(a.term ?? '');
        if (season !== 0) return season;
        return b.first - a.first;
      });
      return {
        school: group.school,
        terms: ordered.map(({ term, year, courses: list }) => ({ term, year, courses: list })),
        transcripts: [...group.transcripts].sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at)),
      };
    });
}

/** "3 credits", "4.5 credits", "1 credit". */
export function creditsLabel(credits: number | null): string | null {
  if (credits === null) return null;
  return `${credits} ${credits === 1 ? 'credit' : 'credits'}`;
}
