import type { SchemaClient } from '@/lib/ask/db';

/**
 * Filing one note in the Dev notes queue, as the notes page, a note on a
 * surface and a comment's file_note all do it (plan #2473.5). Filed open at
 * the middle priority, with the page it came from. The body comes in trimmed
 * and checked. Returns the new note's id.
 */
export async function insertFeedbackItem(
  supabase: SchemaClient,
  note: { userId: string; kind: 'bug' | 'feature' | 'like'; body: string; pagePath: string | null; userAgent?: string | null },
): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase
    .from('feedback_items')
    .insert({
      user_id: note.userId,
      kind: note.kind,
      body: note.body,
      page_path: note.pagePath,
      user_agent: note.userAgent ?? null,
    })
    .select('id')
    .maybeSingle();
  if (error) return { id: null, error: error.message };
  return { id: ((data as { id: string } | null)?.id as string | undefined) ?? null, error: null };
}
