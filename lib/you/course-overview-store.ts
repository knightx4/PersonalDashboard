/**
 * Reading what the course block shows (plan #2401.7): the overviews Dash
 * kept in you.course_overviews, and the person's own vault notes that name
 * each course by its code or title. Both on the person's session clients, so
 * row level security keeps them to their own.
 */
import 'server-only';

import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import {
  COURSE_NOTES_MAX,
  courseNoteNeedles,
  courseNotesFilter,
  noteExcerpt,
  storedRecurring,
  type CourseNote,
  type CourseOverview,
} from '@/lib/you/course-overview';
import type { Course } from '@/lib/you/transcripts';

/** Every overview the person has, by course id. */
export async function loadCourseOverviews(you: YouSupabaseClient, userId: string): Promise<Record<string, CourseOverview>> {
  const { data, error } = await you
    .from('course_overviews')
    .select('course_id, about, recurring, file_ids, model, read_at')
    .eq('user_id', userId);
  if (error) throw new Error(`Loading course overviews failed: ${error.message}`);
  const out: Record<string, CourseOverview> = {};
  for (const row of (data ?? []) as Array<CourseOverview & { course_id: string; recurring: unknown }>) {
    out[row.course_id] = {
      about: row.about,
      recurring: storedRecurring(row.recurring),
      file_ids: row.file_ids ?? [],
      model: row.model,
      read_at: row.read_at,
    };
  }
  return out;
}

/**
 * The notes that name each course, up to COURSE_NOTES_MAX a course: those
 * naming it in their title first, as notes about the course rather than
 * notes that mention it, then newest first. One query a course, for the
 * courses given only: the page passes those with files kept, since the
 * block shows nowhere else.
 */
export async function loadCourseNotes(
  vault: VaultSupabaseClient,
  courses: Pick<Course, 'id' | 'code' | 'title'>[],
): Promise<Record<string, CourseNote[]>> {
  const found = await Promise.all(
    courses.map(async (course): Promise<[string, CourseNote[]]> => {
      const needles = courseNoteNeedles(course);
      const filter = courseNotesFilter(needles);
      if (!filter) return [course.id, []];
      const { data, error } = await vault
        .from('notes')
        .select('id, path, title, body')
        .or(filter)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .limit(COURSE_NOTES_MAX * 4);
      if (error) throw new Error(`Searching the vault for ${course.title} failed: ${error.message}`);
      const notes = ((data ?? []) as Array<{ id: string; path: string; title: string | null; body: string | null }>).map(
        (note) => ({
          id: note.id,
          path: note.path,
          title: note.title || note.path,
          excerpt: noteExcerpt(note.body ?? '', needles),
        }),
      );
      const titled = (note: CourseNote) =>
        needles.some((needle) => note.title.toLowerCase().includes(needle.toLowerCase()));
      const ordered = [...notes.filter(titled), ...notes.filter((note) => !titled(note))];
      return [course.id, ordered.slice(0, COURSE_NOTES_MAX)];
    }),
  );
  return Object.fromEntries(found);
}
