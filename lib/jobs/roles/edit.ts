import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { extractCompBand, extractRequirements, jdHash } from '@/lib/jobs/jd/requirements';

/**
 * Changing a role's own row, the one write the role page's edits, its rename,
 * its move to another company and Dash's change_role all make (plan #2473.2).
 *
 * What each caller checks and records around it differs: the page records the
 * facts it changes as the person's, Dash records them as its own and refuses
 * to replace a firmer one. The row they write is the same, so a rule about
 * the row goes here.
 */

type Row = Record<string, unknown>;

/**
 * The columns a pasted description sets: its hash, its source, the
 * requirements read from it, and the pay band when it names one and the same
 * save sets no pay by hand. A description with no visible range leaves a
 * number from a call with the recruiter alone.
 */
export function descriptionUpdate(description: string | null, payGiven: boolean): { update: Row; payFromPosting: boolean } {
  const text = description?.trim() || null;
  const update: Row = {
    jd_text: text,
    jd_hash: text ? jdHash(text) : null,
    jd_source: text ? 'manual' : null,
    // The nightly board lookup's note explains an empty panel or a title-based
    // match. Once the description is pasted by hand it explains nothing.
    jd_lookup_note: null,
    // Requirements are read once per description; a new one reads them again.
    requirements: text ? extractRequirements(text) : null,
    requirements_extracted_at: text ? new Date().toISOString() : null,
  };
  let payFromPosting = false;
  if (text && !payGiven) {
    const band = extractCompBand(text);
    if (band) {
      update.comp_min_cents = band.minCents;
      update.comp_max_cents = band.maxCents;
      update.comp_source = 'posted';
      payFromPosting = true;
    }
  }
  return { update, payFromPosting };
}

/**
 * Check the years of experience a person typed. Each is a whole number from 0
 * to 60 or null, and a maximum cannot be below the minimum. Returns the message
 * to show, or null when the pair is fine.
 */
export function experienceYearsError(min: number | null, max: number | null): string | null {
  for (const n of [min, max]) {
    if (n === null) continue;
    if (!Number.isInteger(n)) return 'Years of experience must be a whole number.';
    if (n < 0) return 'Years of experience cannot be negative.';
    if (n > 60) return 'Years of experience cannot be more than 60.';
  }
  if (min !== null && max !== null && max < min) {
    return 'The most years cannot be below the least.';
  }
  return null;
}

export type RoleEditError = { message: string; code?: string };

/** Said when the company a role moves to already holds the same posting. */
export const SAME_POSTING =
  'That company already has this same posting. Merge the two from the company page instead.';

/**
 * Write `update` onto one of the person's roles and return the row as it now
 * is. (user_id, company_id, jd_hash) is unique, so a move under a company that
 * already has the same posting comes back as SAME_POSTING.
 */
export async function saveRoleEdit(
  supabase: AppSupabaseClient,
  userId: string,
  roleId: string,
  update: Row,
): Promise<{ row: Row | null; error: RoleEditError | null }> {
  const { data, error } = await supabase
    .from('roles')
    .update(update)
    .eq('id', roleId)
    .eq('user_id', userId)
    .select('*')
    .maybeSingle();
  if (error) {
    return { row: null, error: error.code === '23505' ? { message: SAME_POSTING, code: error.code } : { message: error.message, code: error.code } };
  }
  if (!data) return { row: null, error: { message: 'There is no role of theirs with that id.' } };
  return { row: data as Row, error: null };
}
