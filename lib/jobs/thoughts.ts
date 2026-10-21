import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';

/** The longest entry the table takes (thoughts_body_length_ck in 0026). */
export const THOUGHT_MAX = 20_000;

type Written = { row: Record<string, unknown> | null; error: string | null };

/**
 * A career goals entry added, as Settings' Add and Dash's
 * change_career_thought write one (plan #2473.2).
 */
export async function addThoughtRow(supabase: AppSupabaseClient, userId: string, body: string): Promise<Written> {
  const { data, error } = await supabase.from('thoughts').insert({ user_id: userId, body: body.trim() }).select('*').maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: (data as Record<string, unknown> | null) ?? null, error: null };
}

/** One of their career goals entries reworded. */
export async function saveThoughtEdit(supabase: AppSupabaseClient, userId: string, thoughtId: string, body: string): Promise<Written> {
  const { data, error } = await supabase
    .from('thoughts')
    .update({ body: body.trim() })
    .eq('id', thoughtId)
    .eq('user_id', userId)
    .select('*')
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: (data as Record<string, unknown> | null) ?? null, error: null };
}
