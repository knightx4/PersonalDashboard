import 'server-only';

import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { noteSavePorts } from '@/lib/vault/db/ports';
import type {
  CommitDraftPorts,
  DraftFailure,
  DraftPorts,
  DueDraft,
  NoteDraft,
} from '@/lib/vault/notes/drafts';

/**
 * obsidian.note_drafts behind the ports lib/vault/notes/drafts.ts works
 * through. `draftPorts` runs on the person's session, so RLS keeps it to
 * their drafts; `commitDraftPorts` is the tick's, on the service client, and
 * names the person in every write.
 */

type DraftRow = {
  note_id: string;
  body: string;
  base_blob_sha: string;
  updated_at: string;
  failure: DraftFailure | null;
};

function toDraft(row: DraftRow): NoteDraft {
  return {
    noteId: row.note_id,
    body: row.body,
    baseBlobSha: row.base_blob_sha,
    updatedAt: row.updated_at,
    failure: row.failure,
  };
}

/** The person's draft of one note, or null. */
export async function loadNoteDraft(
  supabase: VaultSupabaseClient,
  noteId: string,
): Promise<NoteDraft | null> {
  const { data, error } = await supabase
    .from('note_drafts')
    .select('note_id, body, base_blob_sha, updated_at, failure')
    .eq('note_id', noteId)
    .maybeSingle();
  if (error) throw new Error(`Reading the note's draft failed: ${error.message}`);
  return data ? toDraft(data as DraftRow) : null;
}

export function draftPorts(supabase: VaultSupabaseClient): DraftPorts {
  return {
    async loadNote(path) {
      const { data, error } = await supabase
        .from('notes')
        .select('id, body, blob_sha')
        .eq('path', path)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) throw new Error(`Reading ${path} failed: ${error.message}`);
      if (!data) return null;
      const row = data as { id: string; body: string; blob_sha: string };
      return { id: row.id, body: row.body, blobSha: row.blob_sha };
    },

    loadDraft: (noteId) => loadNoteDraft(supabase, noteId),

    async insertDraft(noteId, body, baseBlobSha) {
      const { error } = await supabase
        .from('note_drafts')
        .insert({ note_id: noteId, body, base_blob_sha: baseBlobSha });
      if (error) throw new Error(`Keeping the draft failed: ${error.message}`);
    },

    async updateDraft(noteId, body) {
      const { error } = await supabase
        .from('note_drafts')
        .update({ body, updated_at: new Date().toISOString(), failure: null })
        .eq('note_id', noteId);
      if (error) throw new Error(`Keeping the draft failed: ${error.message}`);
    },

    async deleteDraft(noteId) {
      const { error } = await supabase.from('note_drafts').delete().eq('note_id', noteId);
      if (error) throw new Error(`Dropping the draft failed: ${error.message}`);
    },
  };
}

/** Restart a refused draft from the note as it is now, so the next commit writes over it. */
export async function rebaseNoteDraft(
  supabase: VaultSupabaseClient,
  noteId: string,
  blobSha: string,
): Promise<void> {
  const { error } = await supabase
    .from('note_drafts')
    .update({ base_blob_sha: blobSha, failure: null })
    .eq('note_id', noteId);
  if (error) throw new Error(`Restarting the draft failed: ${error.message}`);
}

/**
 * Ports for committing drafts. With `userId` the client is the service one
 * and every write names the person; without, it is the person's session.
 */
export function commitDraftPorts(
  supabase: VaultSupabaseClient,
  opts: { afterSave: (userId: string) => (noteId: string) => void; serviceRole: boolean },
): CommitDraftPorts {
  const scoped = <Q extends { eq(column: string, value: string): Q }>(query: Q, draft: DueDraft): Q =>
    opts.serviceRole ? query.eq('user_id', draft.userId) : query;

  return {
    savePorts: (userId) =>
      noteSavePorts({
        supabase,
        userId: opts.serviceRole ? userId : undefined,
        afterSave: opts.afterSave(userId),
      }),

    async clearDraft(draft) {
      const { error } = await scoped(
        supabase.from('note_drafts').delete().eq('note_id', draft.noteId).eq('updated_at', draft.updatedAt),
        draft,
      );
      if (error) throw new Error(`Clearing the committed draft failed: ${error.message}`);
    },

    async rebaseDraft(draft, blobSha) {
      const { error } = await scoped(
        supabase.from('note_drafts').update({ base_blob_sha: blobSha }).eq('note_id', draft.noteId),
        draft,
      );
      if (error) throw new Error(`Moving the draft on failed: ${error.message}`);
    },

    async refuseDraft(draft, failure) {
      const { error } = await scoped(
        supabase
          .from('note_drafts')
          .update({ failure })
          .eq('note_id', draft.noteId)
          .eq('updated_at', draft.updatedAt),
        draft,
      );
      if (error) throw new Error(`Recording the refused draft failed: ${error.message}`);
    },
  };
}
