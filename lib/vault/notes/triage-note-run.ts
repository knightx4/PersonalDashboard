import 'server-only';

import { noteCreatePorts, noteSavePorts } from '@/lib/vault/db/ports';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { loadInboxNotes } from '@/lib/vault/notes/load';
import { syncTriageNote, type TriageNoteResult } from '@/lib/vault/notes/triage-note';

/**
 * Rebuild the Quick note triage note from the Inbox as it is now, on the
 * person's session (plan #1732). Called after a quick note is added, filed or
 * undone, once that has landed. The note is not embedded: it is not a note to
 * find by meaning, and the suggestions leave it out.
 */
export async function rebuildTriageNote(supabase: VaultSupabaseClient): Promise<TriageNoteResult> {
  try {
    const inbox = await loadInboxNotes(supabase);
    return await syncTriageNote(
      {
        save: noteSavePorts({ supabase, afterSave: () => {} }),
        create: noteCreatePorts({ supabase, afterSave: () => {} }),
      },
      inbox.map((note) => ({ path: note.path, body: note.body })),
    );
  } catch (error) {
    console.error('[vault triage note]', error instanceof Error ? error.message : error);
    return 'failed';
  }
}
