import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';

/**
 * Whether Subjects and Practice offer a new subject built from a theme in
 * your notes (plan #1937.10), kept in `learn.settings.offer_subjects`. On by
 * default, and with no row, which is how the offer behaved before
 * /learn/settings existed.
 */
export async function loadOfferSubjects(learn: LearnSupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await learn
    .from('settings')
    .select('offer_subjects')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`Reading your Learn settings failed: ${error.message}`);
  const on = (data as { offer_subjects: boolean } | null)?.offer_subjects;
  return typeof on === 'boolean' ? on : true;
}

export async function saveOfferSubjects(
  learn: LearnSupabaseClient,
  userId: string,
  on: boolean,
): Promise<void> {
  const { error } = await learn
    .from('settings')
    .upsert(
      { user_id: userId, offer_subjects: on, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
  if (error) throw new Error(`Saving that failed: ${error.message}`);
}
