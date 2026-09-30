import { courseHref } from '@/lib/vault/education';
import { AskInputError, optionalString, type AskContext, type AskToolResult } from './db';

/**
 * courses: what the person studied, from the transcripts saved on the vault's
 * Education tab (plan #1309, under #1304).
 *
 * The command box's search caps a workspace at eight hits, and a term can
 * hold more courses than that, so a question like "what did I take in Fall
 * 2019?" is answered here instead: every saved course, narrowed by term,
 * year, school and words in the code or title. A person has at most a few
 * hundred courses, so they are read whole and matched here, which lets
 * "Fall 2019" find a course whose term says "Fall" and whose year is 2019.
 */

/** The most courses listed; more than any one term or school holds. */
export const COURSE_ROWS = 80;

/** Enough for several degrees' worth of transcripts. */
const COURSE_READ_LIMIT = 2000;

type CourseRow = {
  id: string;
  school: string;
  code: string | null;
  title: string;
  term: string | null;
  year: number | null;
  credits: number | string | null;
  grade: string | null;
  position: number;
  transcript_id: string;
};

/** The words of a filter, lowercased, so "fall 2019" and "Fall, 2019" agree. */
export function filterWords(value: string): string[] {
  return value.toLowerCase().match(/[\p{L}\p{N}.+#-]+/gu) ?? [];
}

/** Whether every word appears somewhere in the text. */
function hasAll(text: string, words: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return words.every((word) => lower.includes(word));
}

/** The term as it should be read: with its year when the term leaves it out. */
export function courseTerm(term: string | null, year: number | null): string | null {
  const written = term?.trim() || null;
  if (!written) return year === null ? null : String(year);
  if (year === null || written.includes(String(year))) return written;
  return `${written} ${year}`;
}

export type CourseFilter = {
  term: string | null;
  year: number | null;
  school: string | null;
  query: string | null;
};

export function courseMatches(course: CourseRow, filter: CourseFilter): boolean {
  if (filter.year !== null && course.year !== filter.year) return false;
  if (filter.term && !hasAll(courseTerm(course.term, course.year) ?? '', filterWords(filter.term))) return false;
  if (filter.school && !hasAll(course.school, filterWords(filter.school))) return false;
  if (filter.query && !hasAll(`${course.code ?? ''} ${course.title}`, filterWords(filter.query))) return false;
  return true;
}

function optionalYear(input: Record<string, unknown>): number | null {
  const value = input.year;
  if (value === undefined || value === null || value === '') return null;
  const year = typeof value === 'string' ? Number(value) : value;
  if (typeof year !== 'number' || !Number.isInteger(year) || year < 1900 || year > 2200) {
    throw new AskInputError('year must be a year such as 2019.');
  }
  return year;
}

export async function coursesLookup(ctx: AskContext, input: Record<string, unknown>): Promise<AskToolResult> {
  const filter: CourseFilter = {
    term: optionalString(input, 'term'),
    year: optionalYear(input),
    school: optionalString(input, 'school'),
    query: optionalString(input, 'query'),
  };

  const client = await ctx.db('obsidian');
  const { data, error } = await client
    .from('courses')
    .select('id, school, code, title, term, year, credits, grade, position, transcript_id')
    .eq('user_id', ctx.userId)
    .order('year', { ascending: true, nullsFirst: false })
    .order('transcript_id', { ascending: true })
    .order('position', { ascending: true })
    .limit(COURSE_READ_LIMIT);
  if (error) throw new Error(`courses: ${error.message}`);
  const all = (data ?? []) as CourseRow[];
  const matched = all.filter((course) => courseMatches(course, filter));

  const narrowed = Boolean(filter.term || filter.year !== null || filter.school || filter.query);
  const note =
    all.length === 0
      ? 'No courses are saved. Transcripts are added on the Education tab of the vault, /vault/education.'
      : matched.length === 0 && narrowed
        ? `None of their ${all.length} saved courses matched. Terms are kept as the transcript writes them; call again with no term to see how they are written.`
        : matched.length > COURSE_ROWS
          ? `${matched.length} matched; only the first ${COURSE_ROWS} are listed. Narrow by term, year or school.`
          : undefined;

  return {
    ok: true,
    rows: matched.slice(0, COURSE_ROWS).map((course) => ({
      table: 'obsidian.courses',
      ref: course.id,
      title: course.code ? `${course.code} ${course.title}` : course.title,
      href: courseHref(course.id),
      detail: {
        school: course.school,
        term: courseTerm(course.term, course.year),
        credits: course.credits === null ? null : Number(course.credits),
        grade: course.grade,
      },
    })),
    totals: { matched: matched.length, saved: all.length },
    ...(note ? { note } : {}),
  };
}
