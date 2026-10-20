import 'server-only';

import { createVaultServiceSupabase } from '@/inngest/vault/supabase-admin';
import { commitDraftPorts } from '@/lib/vault/db/draft-ports';
import { commitDraft, QUIET_MS, type DueDraft } from '@/lib/vault/notes/drafts';

/**
 * The note-drafts tick (vault migration 0040, migration 0272): every five
 * minutes, commit each draft from the vault editor that has sat for ten
 * minutes untouched, so a sitting of writing is one commit.
 *
 * Works every person's drafts, one after another. The service client bypasses
 * RLS, so every write names the person. The note's embedding is left to the
 * map sweep, which picks up any note whose text changed.
 */

/** Drafts committed in one tick at most; the rest wait five minutes. */
const PER_TICK = 25;

type DueRow = {
  note_id: string;
  user_id: string;
  body: string;
  base_blob_sha: string;
  updated_at: string;
  notes: { path: string } | null;
};

export async function runNoteDraftsTick(now = new Date()) {
  const supabase = createVaultServiceSupabase();
  const { data, error } = await supabase
    .from('note_drafts')
    .select('note_id, user_id, body, base_blob_sha, updated_at, notes!inner(path)')
    .is('failure', null)
    .lte('updated_at', new Date(now.getTime() - QUIET_MS).toISOString())
    .order('updated_at')
    .limit(PER_TICK);
  if (error) throw new Error(`Reading the due drafts failed: ${error.message}`);

  const ports = commitDraftPorts(supabase, { serviceRole: true, afterSave: () => () => {} });
  const summary = { committed: 0, unchanged: 0, refused: 0, failed: [] as string[] };
  for (const row of (data ?? []) as unknown as DueRow[]) {
    if (!row.notes) continue;
    const draft: DueDraft = {
      noteId: row.note_id,
      userId: row.user_id,
      path: row.notes.path,
      body: row.body,
      baseBlobSha: row.base_blob_sha,
      updatedAt: row.updated_at,
    };
    try {
      const result = await commitDraft(ports, draft);
      if (result.ok) summary[result.committed ? 'committed' : 'unchanged'] += 1;
      else if (result.reason === 'error') summary.failed.push(row.note_id);
      else summary.refused += 1;
    } catch (err) {
      console.error('[note drafts]', row.note_id, err instanceof Error ? err.message : err);
      summary.failed.push(row.note_id);
    }
  }
  return summary;
}
