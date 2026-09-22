import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';

/**
 * The person's theme names, strongest first, for `proposeNoteMap` to reuse
 * rather than coin a near-duplicate. The extractor keeps the first
 * MAX_EXISTING_THEMES of them, so the order decides which are offered.
 *
 * A failed read returns no names. The proposal still works without them; it
 * only loses the nudge towards names already in use.
 *
 * `userId` is required with a service-role client, which RLS does not narrow:
 * the sweep passes it so one person's theme names are never sent with
 * another's notes.
 */
export async function loadThemeNames(
  supabase: VaultSupabaseClient,
  limit = 200,
  userId?: string,
): Promise<string[]> {
  let query = supabase.from('themes').select('name');
  if (userId) query = query.eq('user_id', userId);
  const { data, error } = await query
    .order('strength', { ascending: false })
    .order('name')
    .limit(limit);
  if (error || !data) return [];
  return (data as { name: string }[]).map((row) => row.name);
}
