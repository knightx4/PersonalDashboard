import type { SchemaClient } from '@/lib/ask/db';
import type { CourseFields } from './education';

/**
 * Writing transcripts and their courses on You's Work & school tab, as the
 * page's forms and Dash's save_transcript and change_course both do it (plan
 * #2473.5). Every write names the user as well as relying on row level
 * security, so the connector's service-role client is held to the person
 * too. Values come in checked (parseCourse, schoolField); the file is already
 * in the transcripts bucket at `storagePath`.
 */

type Row = Record<string, unknown>;

/** Correct one saved course. The row comes back as it is now, or null when no course of theirs has that id. */
export async function updateCourse(
  client: SchemaClient,
  userId: string,
  id: string,
  course: CourseFields,
): Promise<Row | null> {
  const { data, error } = await client.from('courses').update(course).eq('id', id).eq('user_id', userId).select('*');
  if (error) throw new Error(`Correcting the course failed: ${error.message}`);
  return ((data ?? []) as Row[])[0] ?? null;
}

export type TranscriptFile = {
  /** The row's id, when the caller chose it to name the file; the database makes one otherwise. */
  id?: string;
  school: string;
  fileName: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
};

export type SavedTranscript =
  | { ok: true; transcript: Row }
  /** `duplicate`: that file is saved already. `transcript` or `courses`: that write failed, and nothing is left. */
  | { ok: false; failed: 'duplicate' | 'transcript' | 'courses'; message: string };

/**
 * Keep a transcript and the courses on it, in their order. A course list the
 * database refuses takes the transcript back out, so a retry does not meet a
 * half-saved copy. The file is the caller's to remove.
 */
export async function saveTranscriptWithCourses(
  client: SchemaClient,
  userId: string,
  file: TranscriptFile,
  courses: readonly CourseFields[],
): Promise<SavedTranscript> {
  const { data: transcript, error } = await client
    .from('transcripts')
    .insert({
      ...(file.id ? { id: file.id } : {}),
      user_id: userId,
      school: file.school,
      file_name: file.fileName,
      storage_path: file.storagePath,
      mime_type: file.mimeType,
      size_bytes: file.sizeBytes,
    })
    .select('*')
    .single();
  if (error || !transcript) {
    return {
      ok: false,
      failed: error?.code === '23505' ? 'duplicate' : 'transcript',
      message: error?.message ?? 'no row',
    };
  }
  const transcriptId = (transcript as Row).id as string;

  const { error: coursesError } = await client
    .from('courses')
    .insert(courses.map((course, position) => ({ ...course, user_id: userId, transcript_id: transcriptId, position })));
  if (coursesError) {
    await client.from('transcripts').delete().eq('id', transcriptId).eq('user_id', userId);
    return { ok: false, failed: 'courses', message: coursesError.message };
  }
  return { ok: true, transcript: transcript as Row };
}
