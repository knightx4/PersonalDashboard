import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { CONNECTION_WINDOW_DAYS } from '@/lib/vault/notes/connections';
import type { RelatedNoteLink } from '@/lib/vault/notes/related';
import { noteHref } from '@/lib/vault/paths';

/**
 * This week's connections for the vault page (plan #1115): the rows the
 * Monday run wrote in the last eight days that the person has not hidden,
 * each with its notes' titles and links.
 *
 * Eight days rather than seven, so the rows stay up until the next run
 * replaces them even when that run is a few minutes late. A note deleted
 * since the run is left out, and a connection left with no recent note or no
 * older note is not shown at all.
 */

export type WeekConnection = {
  id: string;
  sentence: string | null;
  older: RelatedNoteLink;
  recent: RelatedNoteLink[];
};

type ConnectionRow = {
  id: string;
  week_ending: string;
  sentence: string | null;
  older_note_id: string;
  recent_note_ids: string[];
};

type NoteRow = { id: string; path: string; title: string | null };

export function shapeConnections(rows: readonly ConnectionRow[], notes: readonly NoteRow[]): WeekConnection[] {
  const byId = new Map(
    notes.map((note): [string, RelatedNoteLink] => [
      note.id,
      { noteId: note.id, title: note.title?.trim() || note.path, href: noteHref(note.path) },
    ]),
  );
  return rows.flatMap((row) => {
    const older = byId.get(row.older_note_id);
    const recent = row.recent_note_ids.flatMap((id) => byId.get(id) ?? []);
    if (!older || recent.length === 0) return [];
    return [{ id: row.id, sentence: row.sentence, older, recent }];
  });
}

/** Never throws: a failed read shows no connections. */
export async function loadWeekConnections(
  vault: VaultSupabaseClient,
  now: Date = new Date(),
): Promise<WeekConnection[]> {
  const after = new Date(now.getTime() - (CONNECTION_WINDOW_DAYS + 1) * 86_400_000).toISOString();
  const { data, error } = await vault
    .from('note_connections')
    .select('id, week_ending, sentence, older_note_id, recent_note_ids')
    .is('dismissed_at', null)
    .gte('created_at', after)
    .order('created_at', { ascending: false })
    .order('similarity', { ascending: false })
    .limit(6);
  if (error) {
    console.error('[vault connections] reading failed', error.message);
    return [];
  }
  const rows = (data ?? []) as ConnectionRow[];
  if (rows.length === 0) return [];

  // Only the newest week's rows, if two runs fall inside the window.
  const newest = rows.filter((row) => row.week_ending === rows[0]!.week_ending);
  const ids = [...new Set(newest.flatMap((row) => [row.older_note_id, ...row.recent_note_ids]))];
  const { data: notes, error: notesError } = await vault
    .from('notes')
    .select('id, path, title')
    .in('id', ids)
    .is('deleted_at', null);
  if (notesError) {
    console.error('[vault connections] reading the notes failed', notesError.message);
    return [];
  }
  return shapeConnections(newest, (notes ?? []) as NoteRow[]);
}
