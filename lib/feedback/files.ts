import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { toRef } from '@/lib/core/refs';
import { ATTACHMENTS_BUCKET } from '@/lib/attachments/rules';
import { listAttachments } from '@/lib/attachments/store';
import { FEEDBACK_TABLE, type FeedbackRow } from '@/lib/feedback/load';

/** The ref a note's files are recorded against. */
export function noteRef(id: string): string {
  return toRef(FEEDBACK_TABLE, id);
}

/**
 * Put each note's files on it, in one read for the whole list (plan #1713).
 * The rows are changed in place, since a queue holds the same row in more
 * than one of its lists. A failed read leaves the notes without files rather
 * than failing the page: the note is the thing to read, and the files are
 * still there next time.
 */
export async function withNoteFiles(
  core: CoreSupabaseClient,
  rows: FeedbackRow[],
): Promise<void> {
  if (rows.length === 0) return;
  try {
    const byRef = await listAttachments(core, rows.map((row) => noteRef(row.id)));
    for (const row of rows) row.attachments = byRef.get(noteRef(row.id)) ?? [];
  } catch (error) {
    console.error(`Reading the notes' files failed: ${(error as Error).message}`);
  }
}

/** How long a link in a run's brief opens its file: long enough for a batch. */
export const BRIEF_LINK_SECONDS = 12 * 60 * 60;

export type BriefFile = { noteId: string; name: string; contentType: string; url: string };

/**
 * The lines a notes run is fired with when the notes it will work hold files
 * (plan #1713). A run reaches the database through SQL, which cannot read
 * the private bucket, so the app signs a link to each file on your session
 * and the brief carries it. Null when there are none.
 */
export function noteFilesBrief(files: readonly BriefFile[]): string | null {
  if (files.length === 0) return null;
  const lines = files.map(
    (file) => `- note ${file.noteId.slice(0, 8)}: ${file.name} (${file.contentType}) ${file.url}`,
  );
  return [
    `Files filed with the notes in the queue. Download and open each before working its note; the links stop working ${BRIEF_LINK_SECONDS / 3600} hours after this run was started.`,
    ...lines,
  ].join('\n');
}

/**
 * Sign a link to each file on the outstanding notes, for noteFilesBrief.
 * Best effort: a run fired without the links still has the note's text, and
 * the skill says how to list a note's files without them.
 */
export async function outstandingNoteFiles(
  core: CoreSupabaseClient,
  noteIds: readonly string[],
): Promise<BriefFile[]> {
  if (noteIds.length === 0) return [];
  try {
    const byRef = await listAttachments(core, noteIds.map(noteRef));
    const files = noteIds.flatMap((noteId) =>
      (byRef.get(noteRef(noteId)) ?? []).map((file) => ({ noteId, file })),
    );
    if (files.length === 0) return [];
    const { data, error } = await core.storage
      .from(ATTACHMENTS_BUCKET)
      .createSignedUrls(
        [...new Set(files.map(({ file }) => file.path))],
        BRIEF_LINK_SECONDS,
      );
    if (error || !data) return [];
    const signed = new Map(
      data.flatMap((entry) => (entry.path && entry.signedUrl ? [[entry.path, entry.signedUrl]] : [])),
    );
    return files.flatMap(({ noteId, file }) => {
      const url = signed.get(file.path);
      return url ? [{ noteId, name: file.name, contentType: file.contentType, url }] : [];
    });
  } catch (error) {
    console.error(`Signing the notes' files failed: ${(error as Error).message}`);
    return [];
  }
}
