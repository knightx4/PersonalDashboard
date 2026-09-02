import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { domainFromUrl, slugify } from '@/lib/jobs/slug';

/**
 * Find or create a company by name, filling in domains from the URL we have.
 *
 * Shared rather than duplicated: creating a role and moving one to the company
 * it actually belongs to are the same question -- "which company is this?" --
 * and a second copy of the answer is how two paths end up disagreeing about
 * what counts as the same company.
 */
export async function ensureCompany(
  supabase: AppSupabaseClient,
  userId: string,
  name: string,
  hints: {
    careersUrl?: string | null;
    website?: string | null;
    boardToken?: string | null;
    ats?: string | null;
  } = {},
): Promise<{ id: string; error: string | null }> {
  const slug = slugify(name);

  const { data: existing } = await supabase
    .from('companies')
    .select('id, domains, ats_board_token')
    .eq('user_id', userId)
    .eq('slug', slug)
    .maybeSingle();

  const domain = domainFromUrl(hints.website) ?? domainFromUrl(hints.careersUrl);

  if (existing) {
    // Top up what we learned without clobbering anything the user edited.
    const patch: Record<string, unknown> = {};
    if (domain && !(existing.domains as string[]).includes(domain)) {
      patch.domains = [...(existing.domains as string[]), domain];
    }
    if (hints.boardToken && !existing.ats_board_token) patch.ats_board_token = hints.boardToken;
    if (Object.keys(patch).length > 0) {
      await supabase.from('companies').update(patch).eq('id', existing.id);
    }
    return { id: existing.id as string, error: null };
  }

  const { data, error } = await supabase
    .from('companies')
    .insert({
      user_id: userId,
      name: name.trim(),
      slug,
      // domains is what lets a recruiter's personal work address find this
      // company later, so it is seeded from whatever URL we have on day one.
      domains: domain ? [domain] : [],
      careers_url: hints.careersUrl ?? null,
      website: hints.website ?? null,
      ats_board_token: hints.boardToken ?? null,
      ats_type: (hints.ats as never) ?? 'unknown',
    })
    .select('id')
    .single();

  if (error || !data) return { id: '', error: error?.message ?? 'Could not create the company.' };
  return { id: data.id as string, error: null };
}
