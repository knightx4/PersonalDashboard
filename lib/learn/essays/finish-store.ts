import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';

/**
 * What Finish reads and writes on `learn.essays` (plan #1873), through the
 * person's own session.
 */

export type FinishRow = {
  brief: unknown;
  draftBody: string;
  path: string;
  noteId: string | null;
  evidenceItemId: string | null;
};

export async function loadFinishRow(supabase: LearnSupabaseClient, id: string): Promise<FinishRow | null> {
  const { data, error } = await supabase
    .from('essays')
    .select('brief, draft_body, path, note_id, evidence_item_id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Could not read the essay: ${error.message}`);
  if (!data) return null;
  const row = data as {
    brief: unknown;
    draft_body: string | null;
    path: string;
    note_id: string | null;
    evidence_item_id: string | null;
  };
  return {
    brief: row.brief,
    draftBody: row.draft_body ?? '',
    path: row.path,
    noteId: row.note_id,
    evidenceItemId: row.evidence_item_id,
  };
}

/** Mark the essay finished now. */
export async function markFinished(supabase: LearnSupabaseClient, id: string, at: string): Promise<void> {
  const { error } = await supabase.from('essays').update({ finished_at: at }).eq('id', id);
  if (error) throw new Error(`Could not mark the essay finished: ${error.message}`);
}

/** Keep the evidence item made from the essay, so it is never added twice. */
export async function recordEvidenceItem(
  supabase: LearnSupabaseClient,
  id: string,
  evidenceItemId: string,
): Promise<void> {
  const { error } = await supabase.from('essays').update({ evidence_item_id: evidenceItemId }).eq('id', id);
  if (error) throw new Error(`Could not record the evidence item: ${error.message}`);
}
