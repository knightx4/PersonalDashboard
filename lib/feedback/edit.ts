import type { SchemaClient } from '@/lib/ask/db';
import { OUTSTANDING_STATUSES } from '@/lib/feedback/load';

/**
 * Rewording one note in the Dev notes queue, as the note's Edit and a
 * comment's reword both do it (plan #2473.9). Only a note still waiting to be
 * worked: a closed one says what was done about it, so it has to be reopened
 * before what it asks for can change. The body comes in trimmed and checked;
 * `kind` is left as it is when not given. Returns the body it replaced.
 */
export async function editFeedbackItem(
  supabase: SchemaClient,
  note: { userId: string; id: string; body: string; kind?: 'bug' | 'feature' | 'like' },
): Promise<{ was: string } | { error: string }> {
  if (note.body.trim().length < 3) return { error: 'Write a sentence or two describing it.' };
  const { data: existing } = await supabase
    .from('feedback_items')
    .select('status, body')
    .eq('id', note.id)
    .eq('user_id', note.userId)
    .maybeSingle();
  const row = existing as { status: string; body: string } | null;
  if (!row) return { error: 'That note no longer exists.' };
  if (!(OUTSTANDING_STATUSES as readonly string[]).includes(row.status)) {
    return { error: 'That one is already closed. Reopen it first to change what it asks for.' };
  }

  const { error } = await supabase
    .from('feedback_items')
    .update({ ...(note.kind ? { kind: note.kind } : {}), body: note.body })
    .eq('id', note.id)
    .eq('user_id', note.userId);
  if (error) return { error: error.message };
  return { was: row.body };
}
