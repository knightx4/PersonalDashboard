/**
 * Courses as evidence for ideas (plan #2006.4): the text a course is embedded
 * from, how much a link to it counts, and the sentence saying why. Pure, so
 * the weights can be tested without a database. The store that runs it is
 * ./course-store.
 *
 * A course counts by its grade and by its age. An A or an honours grade
 * counts fully, a credit or a pass less, and a course in progress, waived or
 * failed not at all, so it is never linked. A course's weight halves every
 * eight years, to a floor: a 2017 course counts about half what a 2025 one
 * does, and the AP credits of 2016 still count for something.
 */

/** One course as learn.course_sources returns it (migration learn 0123). */
export type CourseSource = {
  course_id: string;
  school: string;
  code: string | null;
  title: string;
  term: string | null;
  year: number | null;
  grade: string | null;
  /** The course's notes, its summary first. */
  notes: string[];
  catalogue_description: string | null;
};

/**
 * The longest text embedded for one course. The vector stands for the course
 * as a whole, mostly its summary's opening; the detail is matched through the
 * notes' own passages (learn.course_idea_matches), so more text would cost
 * more and blur the vector.
 */
export const COURSE_TEXT_MAX_CHARS = 8_000;

/** A course with notes or a description is linked at this similarity or above. */
export const COURSE_MIN_SIMILARITY = 0.6;
/** A course known by its title alone says little, so it has to match more closely. */
export const COURSE_TITLE_ONLY_MIN_SIMILARITY = 0.7;

const AGE_HALF_LIFE_YEARS = 8;
const AGE_FLOOR = 0.3;
/** A course with no year counts as if it were this old. */
const UNDATED_AGE_YEARS = 8;

/** Whether a course has nothing to embed beyond its title. */
export function isTitleOnly(course: CourseSource): boolean {
  return course.notes.length === 0 && !course.catalogue_description?.trim();
}

/** "FIN 410 Corporate Finance", or the title alone when there is no code. */
export function courseName(course: Pick<CourseSource, 'code' | 'title'>): string {
  const code = course.code?.trim();
  return code ? `${code} ${course.title.trim()}` : course.title.trim();
}

/**
 * The text a course is embedded from: its name and where and when it was
 * taken, the catalogue's description of a course by that title, then its
 * notes with the summary first, cut at COURSE_TEXT_MAX_CHARS.
 */
export function courseText(course: CourseSource): string {
  const taken = [
    course.school.trim(),
    course.term?.trim() || (course.year ? String(course.year) : ''),
  ]
    .filter(Boolean)
    .join(', ');
  const parts = [`${courseName(course)}${taken ? ` (${taken})` : ''}`];
  const description = course.catalogue_description?.trim();
  if (description) parts.push(description);
  for (const note of course.notes) {
    const body = note.trim();
    if (body) parts.push(body);
  }
  const text = parts.join('\n\n');
  return text.length > COURSE_TEXT_MAX_CHARS ? text.slice(0, COURSE_TEXT_MAX_CHARS) : text;
}

/**
 * How much a grade counts, 0 to 1. Read as the transcript writes it: "A-",
 * "HH" (high honours, as some business schools grade), "CR", "TA" (a transfer credit earned with an
 * A). Anything not recognised, and a missing grade, counts nothing.
 */
export function gradeFactor(grade: string | null): number {
  let g = (grade ?? '').trim().toUpperCase();
  if (!g) return 0;
  // A transfer credit with its grade after the T.
  if (/^T[A-D][+-]?$/.test(g)) g = g.slice(1);

  if (/^A[+-]?$/.test(g) || g === 'H' || g === 'HH' || g === 'HP' || g === 'DIST') return 1;
  if (/^B[+-]?$/.test(g)) return 0.8;
  if (g === 'CR' || g === 'P' || g === 'PASS' || g === 'S' || g === 'T' || g === 'TR') return 0.6;
  if (/^C[+-]?$/.test(g)) return 0.55;
  if (g === 'LP') return 0.4;
  if (/^D[+-]?$/.test(g)) return 0.3;
  // In progress, waived, withdrawn, incomplete, audited, failed.
  return 0;
}

/** How much a course's age leaves of it, 0.3 to 1: halved every eight years. */
export function ageFactor(year: number | null, nowYear: number): number {
  const age = year === null ? UNDATED_AGE_YEARS : Math.max(0, nowYear - year);
  return Math.max(AGE_FLOOR, 0.5 ** (age / AGE_HALF_LIFE_YEARS));
}

/** The weight of a link to this course, 0 to 1, to three places. Zero means no link. */
export function courseWeight(
  course: Pick<CourseSource, 'grade' | 'year'>,
  nowYear: number,
): number {
  const weight = gradeFactor(course.grade) * ageFactor(course.year, nowYear);
  return Math.round(weight * 1000) / 1000;
}

/** "from FIN 410 Corporate Finance, HH, 2026": the grade as the transcript writes it. */
export function courseBasis(
  course: Pick<CourseSource, 'code' | 'title' | 'grade' | 'year'>,
): string {
  const parts = [courseName(course)];
  const grade = course.grade?.trim();
  if (grade) parts.push(grade);
  if (course.year) parts.push(String(course.year));
  return `from ${parts.join(', ')}`;
}

/** One match from learn.course_idea_matches. */
export type CourseMatch = { course_id: string; concept_id: string; similarity: number };

/** A row for learn.evidence_links, less the user id the store adds. */
export type CourseLinkRow = {
  target_kind: 'idea';
  target_id: string;
  source_kind: 'course';
  source_id: string;
  similarity: number;
  weight: number;
  basis: string;
};

/**
 * The links the matches make. A match to a course whose grade counts nothing
 * (in progress, waived) or that is no longer listed makes none.
 */
export function courseLinks(
  matches: CourseMatch[],
  courses: CourseSource[],
  nowYear: number,
): CourseLinkRow[] {
  const byId = new Map(courses.map((course) => [course.course_id, course]));
  const rows: CourseLinkRow[] = [];
  for (const match of matches) {
    const course = byId.get(match.course_id);
    if (!course) continue;
    const weight = courseWeight(course, nowYear);
    if (weight <= 0) continue;
    rows.push({
      target_kind: 'idea',
      target_id: match.concept_id,
      source_kind: 'course',
      source_id: course.course_id,
      similarity: Math.min(1, Math.max(0, match.similarity)),
      weight,
      basis: courseBasis(course),
    });
  }
  return rows;
}
