/**
 * Which transcript courses have been read into Learn, as the Tracks page shows
 * them (plan #1391, under #1388). The rows are learn.course_reads (0086); the
 * rules here are kept pure so the tests can reach them.
 */

/** One course_reads row as the page selects it. */
export type CourseReadRow = {
  course_id: string;
  subject_id: string | null;
  concepts_added: number;
  read_at: string;
};

/** A course's read, with the track it went into named. */
export type CourseRead = {
  /** The track, or null when it has since been removed. */
  subject: { id: string; name: string } | null;
  conceptsAdded: number;
  readAt: string;
};

/** The reads by course id, each naming its track when the track still exists. */
export function readsByCourse(
  rows: CourseReadRow[],
  subjects: { id: string; name: string }[],
): Record<string, CourseRead> {
  const names = new Map(subjects.map((subject) => [subject.id, subject.name]));
  const reads: Record<string, CourseRead> = {};
  for (const row of rows) {
    const name = row.subject_id ? names.get(row.subject_id) : undefined;
    reads[row.course_id] = {
      subject: row.subject_id && name !== undefined ? { id: row.subject_id, name } : null,
      conceptsAdded: row.concepts_added,
      readAt: row.read_at,
    };
  }
  return reads;
}

/**
 * The count a read leaves on the row. A second read into the same track adds
 * to what the first kept, since the first read's ideas are still there; a read
 * into a different track starts the count again, because the row now names
 * the new track and the number has to describe it.
 */
export function conceptsAfterRead(
  previous: { subject_id: string | null; concepts_added: number } | null,
  subjectId: string,
  added: number,
): number {
  if (previous && previous.subject_id === subjectId) return previous.concepts_added + added;
  return added;
}

/** "Read into Economics, 6 ideas known", for a course's row. */
export function readLine(read: CourseRead): string {
  const ideas = `${read.conceptsAdded} ${read.conceptsAdded === 1 ? 'idea' : 'ideas'} known`;
  return read.subject
    ? `Read into ${read.subject.name}, ${ideas}`
    : `Read, ${ideas}; that track has since been removed`;
}
