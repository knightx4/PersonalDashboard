/**
 * The files kept under a course on You's Work & school tab (plan #2401.2):
 * the rules the list, the upload and the actions share, kept pure so the
 * tests can reach them. The table and the bucket are described in
 * lib/you/transcripts.ts and supabase/migrations-you/0008_course_files.sql.
 *
 * - Which files the bucket keeps, and the content type each goes in under.
 * - Which chosen files are refused before any upload, and why.
 * - The order the list shows: the syllabus, then the lectures by week, then
 *   the readings.
 */

import { attachmentSize } from '@/lib/attachments/rules';
import { EDUCATION_HREF, TRANSCRIPT_ACCEPT, transcriptContentType } from '@/lib/you/education';
import {
  COURSE_FILES_MAX,
  COURSE_FILE_MAX_BYTES,
  isCourseFileKind,
  type CourseFile,
  type CourseFileKind,
  type CourseFileMimeType,
  type CourseWeek,
} from '@/lib/you/transcripts';

const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** The file picker's accept list: a transcript's types and PowerPoint. */
export const COURSE_FILE_ACCEPT = `${TRANSCRIPT_ACCEPT},.pptx`;

/** What the picker says it takes. */
export const COURSE_FILE_HINT = 'PDF, PowerPoint, Word, a photo or text, up to 20 MB each.';

/** The content type a course file is kept under, from its name, or null for one the bucket refuses. */
export function courseFileContentType(name: string): CourseFileMimeType | null {
  if (/\.pptx$/i.test(name.trim())) return PPTX;
  return transcriptContentType(name);
}

/** Where a course file's original opens, through a one-minute signed link. */
export function courseFileHref(id: string): string {
  return `${EDUCATION_HREF}/course-file/${id}`;
}

/**
 * Whether a storage path is one of this account's uploads under this course:
 * `<user id>/<course id>/<uuid>-<safe name>`, as courseFileStoragePath writes it.
 */
export function ownsCourseFilePath(userId: string, courseId: string, path: string): boolean {
  if (!userId || !courseId) return false;
  const folder = `${userId}/${courseId}/`;
  if (!path.startsWith(folder)) return false;
  return /^[0-9a-f-]{36}-[A-Za-z0-9._-]{1,120}$/.test(path.slice(folder.length));
}

/** A size as the list shows it. */
export function courseFileSize(bytes: number): string {
  return attachmentSize(bytes);
}

/** The title a new file takes: its name without the extension, as long as the table allows. */
export function courseFileTitle(fileName: string): string {
  const name = fileName.trim().replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (name || fileName.trim() || 'File').slice(0, 300);
}

/**
 * Why each chosen file will not be kept, or null for one that will, in the
 * order they were chosen. `held` is how many the course already holds, so the
 * files past the twentieth are refused here rather than by the database.
 */
export function refuseCourseFiles(files: Array<{ name: string; size: number }>, held: number): Array<string | null> {
  let room = Math.max(0, COURSE_FILES_MAX - held);
  return files.map((file) => {
    if (!courseFileContentType(file.name)) {
      return 'Not a file the course can keep. Use a PDF, PowerPoint, Word document, photo or text file.';
    }
    if (file.size > COURSE_FILE_MAX_BYTES) return `Over 20 MB (${courseFileSize(file.size)}).`;
    if (file.size === 0) return 'The file is empty.';
    if (room === 0) return `A course holds at most ${COURSE_FILES_MAX} files.`;
    room -= 1;
    return null;
  });
}

/** Read a week from a form: blank is no week, otherwise a whole number from 0 to 60. */
export function parseWeek(value: string | null | undefined): { ok: true; week: number | null } | { ok: false } {
  const text = (value ?? '').trim();
  if (text === '') return { ok: true, week: null };
  if (!/^\d{1,2}$/.test(text)) return { ok: false };
  const week = Number(text);
  return week <= 60 ? { ok: true, week } : { ok: false };
}

export function parseKind(value: unknown): CourseFileKind | null {
  return typeof value === 'string' && isCourseFileKind(value) ? value : null;
}

/**
 * One heading of a course's file list and the files under it. A week laid
 * out from the syllabus (plan #2401.6) carries its kept row as `slot`, with
 * the topic the heading shows beside the week; a week with no slot is one
 * only a file's week formed.
 */
export type CourseFileGroup = { key: string; label: string; files: CourseFile[]; slot?: CourseWeek };

/** Lectures before readings within a week; the syllabus has its own heading. */
const KIND_ORDER: Record<CourseFile['kind'], number> = { syllabus: 0, slides: 1, lecture_notes: 1, reading: 2 };

const byKindThenPosition = (a: CourseFile, b: CourseFile) =>
  KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
  a.position - b.position ||
  a.uploaded_at.localeCompare(b.uploaded_at);

/**
 * A course's files as the list shows them, week by week (plan #2401.5): the
 * syllabus first, then a heading for each week, in week order, with its
 * lectures (slides and lecture notes, in the order they were added) and then
 * its readings. Files with no week come last under "No week", in the same
 * order. The kind is a fact on each row, so every heading after the syllabus
 * is a week.
 *
 * The weeks come from two places: every week laid out from the syllabus and
 * not removed (plan #2401.6), which shows as a slot even with no file in it,
 * and every week a file names. A removed week still heads the files that
 * name it. Other empty groups are left out.
 */
export function groupCourseFiles(files: CourseFile[], slots: CourseWeek[] = []): CourseFileGroup[] {
  const groups: CourseFileGroup[] = [];
  const syllabus = files.filter((f) => f.kind === 'syllabus');
  if (syllabus.length > 0) groups.push({ key: 'syllabus', label: 'Syllabus', files: [...syllabus].sort(byKindThenPosition) });
  const rest = files.filter((f) => f.kind !== 'syllabus');
  const shown = new Map(slots.filter((s) => !s.removed_at).map((s) => [s.week, s]));
  const weeks = [
    ...new Set([...shown.keys(), ...rest.map((f) => f.week).filter((w): w is number => w !== null)]),
  ].sort((a, b) => a - b);
  for (const week of weeks) {
    const slot = shown.get(week);
    groups.push({
      key: `week-${week}`,
      label: `Week ${week}`,
      files: rest.filter((f) => f.week === week).sort(byKindThenPosition),
      ...(slot ? { slot } : {}),
    });
  }
  const loose = rest.filter((f) => f.week === null);
  if (loose.length > 0) groups.push({ key: 'no-week', label: 'No week', files: loose.sort(byKindThenPosition) });
  return groups;
}

/** What a week is called where it is picked, such as the add drawer's week list: "Week 3 · Elasticity". */
export function weekName(slot: Pick<CourseWeek, 'week' | 'title'>): string {
  return slot.title ? `Week ${slot.week} · ${slot.title}` : `Week ${slot.week}`;
}

/** How many files a course holds, as its row says it. */
export function courseFilesCount(count: number): string {
  return `${count} ${count === 1 ? 'file' : 'files'}`;
}
