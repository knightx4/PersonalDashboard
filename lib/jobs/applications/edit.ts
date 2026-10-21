import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { ApplicationSource } from '@/lib/jobs/pipeline';

/**
 * Changing an application's own marks: how excited they are, how they
 * applied, and the three marks on the role page's tabs. The pipeline's
 * pickers, the role page's marks and Dash's change_application all write
 * through here (plan #2473.2).
 */

export type ApplicationEdit = {
  excitement?: number | null;
  source?: ApplicationSource;
  referral_contact_id?: string | null;
  ready_to_apply?: boolean;
  all_questions_added?: boolean;
  has_cover_letter?: boolean | null;
};

/** Excitement runs from 1 to 5, or null for none. */
export function excitementError(excitement: number | null): string | null {
  if (excitement === null) return null;
  return Number.isInteger(excitement) && excitement >= 1 && excitement <= 5 ? null : 'Excitement runs from 1 to 5.';
}

/**
 * How they applied. A referral names who referred them; any other channel
 * clears it, so a stale name does not stay behind a channel that no longer
 * has one.
 */
export function channelEdit(source: ApplicationSource, referralContactId: string | null): ApplicationEdit {
  return { source, referral_contact_id: source === 'referral' ? referralContactId : null };
}

/** A cover letter is at most this long. */
export const COVER_LETTER_MAX = 20_000;

/**
 * The cover letter under the application's answers, in
 * applications.cover_letter (not cover_letters.body, the shared case page's
 * statement). Saving it empty clears it. A letter Dash drafted (`drafted`)
 * also sets the Cover letter mark to yes, as inserting Dash's draft does.
 */
export async function saveCoverLetterText(
  supabase: AppSupabaseClient,
  userId: string,
  applicationId: string,
  body: string,
  drafted: boolean,
): Promise<{ error: string | null }> {
  const text = body.trim();
  if (text.length > COVER_LETTER_MAX) return { error: 'A cover letter is at most 20,000 characters.' };
  const patch: { cover_letter: string | null; has_cover_letter?: boolean } = { cover_letter: text || null };
  if (drafted && text) patch.has_cover_letter = true;
  const { error } = await supabase.from('applications').update(patch).eq('id', applicationId).eq('user_id', userId);
  return { error: error?.message ?? null };
}

/** Write `patch` onto one of the person's applications. */
export async function saveApplicationEdit(
  supabase: AppSupabaseClient,
  userId: string,
  applicationId: string,
  patch: ApplicationEdit,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('applications').update(patch).eq('id', applicationId).eq('user_id', userId);
  return { error: error?.message ?? null };
}
