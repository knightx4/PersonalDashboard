import 'server-only';

import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { noteMapSchema, type NoteMap } from '@/lib/vault/map/proposal';

/**
 * Write an accepted map for one note.
 *
 * The only path from a proposal into the obsidian map tables. It hands the
 * map to obsidian.accept_note_map (supabase/migrations-vault/0003), which
 * writes it in one transaction and refuses the whole of it when the note has
 * changed since it was read or any quote is no longer in the note. The
 * function also recomputes the strength of every theme it touched.
 *
 * With the session client RLS decides which note is visible. The sweep can
 * pass a service-role client: the rows are owned by the note's owner either
 * way.
 */

export type AcceptResult =
  | { ok: true; themes: number; positions: number; newPositions: number; edges: number }
  | {
      ok: false;
      reason: 'invalid' | 'stale-note' | 'quote-missing' | 'gone' | 'error';
      detail: string;
    };

export async function acceptNoteMap(
  supabase: VaultSupabaseClient,
  input: { noteId: string; blobSha: string; map: NoteMap },
): Promise<AcceptResult> {
  const parsed = noteMapSchema.safeParse(input.map);
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid',
      detail: parsed.error.issues[0]?.message ?? 'The map is malformed.',
    };
  }
  if (parsed.data.themes.length === 0) {
    return { ok: false, reason: 'invalid', detail: 'Nothing was ticked, so nothing was written.' };
  }

  const { data, error } = await supabase.rpc('accept_note_map', {
    p_note_id: input.noteId,
    p_blob_sha: input.blobSha,
    p_map: parsed.data,
  });

  if (error) {
    if (error.code === 'P0002') return { ok: false, reason: 'gone', detail: error.message };
    if (error.details === 'stale-note') {
      return {
        ok: false,
        reason: 'stale-note',
        detail: 'The note has changed since it was read. Read it again.',
      };
    }
    if (error.details === 'quote-missing') {
      return { ok: false, reason: 'quote-missing', detail: error.message };
    }
    return { ok: false, reason: 'error', detail: error.message };
  }

  const counts = data as { themes: number; positions: number; newPositions: number; edges: number };
  return { ok: true, ...counts };
}
