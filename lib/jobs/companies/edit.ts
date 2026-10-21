import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { slugify } from '@/lib/jobs/slug';

/**
 * Changing a company's own row: the company page's fields, its rename and
 * Dash's change_company all write through here (plan #2473.2).
 */

type Row = Record<string, unknown>;

/** A company's name, as the page's rename and Dash both cap it. */
export const COMPANY_NAME_MAX = 120;

/**
 * Domains as the company page saves them. They link mail to the company, so
 * "https://www.acme.com/jobs" is kept as "acme.com", anything that is not a
 * domain is left out, and each is kept once.
 */
export function normalisedDomains(entries: readonly string[]): string[] {
  return [
    ...new Set(
      entries
        .map((entry) => entry.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''))
        .filter((entry) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(entry)),
    ),
  ];
}

/**
 * The columns a rename sets, or the sentence refusing it. The slug is the
 * company's address and what the inbox matches it by, so it moves with the
 * name, and a name whose slug another of their companies has is refused
 * before (user_id, slug) in the database would refuse it less clearly.
 */
export async function renameUpdate(
  supabase: AppSupabaseClient,
  userId: string,
  companyId: string,
  name: string,
): Promise<{ update: { name: string; slug: string }; error: null } | { update: null; error: string }> {
  const slug = slugify(name);
  const { data: clash, error } = await supabase
    .from('companies')
    .select('id, name')
    .eq('user_id', userId)
    .eq('slug', slug)
    .neq('id', companyId)
    .maybeSingle();
  if (error) return { update: null, error: error.message };
  if (clash) return { update: null, error: `You already have a company called ${(clash as Row).name as string}.` };
  return { update: { name, slug }, error: null };
}

/** Write `patch` onto one of the person's companies and return the row as it now is. */
export async function saveCompanyEdit(
  supabase: AppSupabaseClient,
  userId: string,
  companyId: string,
  patch: Row,
): Promise<{ row: Row | null; error: { message: string; code?: string } | null }> {
  const { data, error } = await supabase
    .from('companies')
    .update(patch)
    .eq('id', companyId)
    .eq('user_id', userId)
    .select('*')
    .maybeSingle();
  if (error) return { row: null, error: { message: error.message, code: error.code } };
  if (!data) return { row: null, error: { message: 'That company is not on your list.' } };
  return { row: data as Row, error: null };
}
