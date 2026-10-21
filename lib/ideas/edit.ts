import type { SchemaClient } from '@/lib/ask/db';
import type { ModuleId } from '@/lib/modules';

/**
 * Rewriting one idea, as the ideas page's Edit and a comment's reword both do
 * it (plan #2473.9). The body comes in trimmed and checked; `module` is left
 * as it is when not given. An idea that is not there, or is somebody else's,
 * is refused rather than written to nothing. Returns the body it replaced.
 */
export async function editIdea(
  supabase: SchemaClient,
  idea: { userId: string; id: string; body: string; module?: ModuleId | string | null },
): Promise<{ was: string } | { error: string }> {
  if (idea.body.trim().length < 3) return { error: 'Write a sentence.' };
  const { data: existing } = await supabase
    .from('ideas')
    .select('body')
    .eq('id', idea.id)
    .eq('user_id', idea.userId)
    .maybeSingle();
  const row = existing as { body: string } | null;
  if (!row) return { error: 'That idea no longer exists.' };

  const { error } = await supabase
    .from('ideas')
    .update({ body: idea.body, ...(idea.module !== undefined ? { module: idea.module } : {}) })
    .eq('id', idea.id)
    .eq('user_id', idea.userId);
  if (error) return { error: error.message };
  return { was: row.body };
}
