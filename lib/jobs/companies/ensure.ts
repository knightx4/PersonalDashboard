import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { slugify } from '@/lib/jobs/slug';
import { employerDomain, findSameCompany, type CompanyIdentity } from '@/lib/jobs/companies/same-company';

const IDENTITY_COLUMNS = 'id, name, slug, domains, website, ats_type, ats_board_token';

type ExistingCompany = CompanyIdentity & { id: string; slug: string; domains: string[] };

/**
 * The company a new one would duplicate, or null.
 *
 * The slug is checked first because it is free. Matching on it alone is how
 * Heron and Heron Data became two rows, so a miss reads the person's companies
 * and asks `findSameCompany` about the board, the domain and the name. Shared
 * with the inbox, which creates companies from mail by the same question.
 */
export async function findExistingCompany(
  supabase: AppSupabaseClient,
  userId: string,
  candidate: CompanyIdentity,
): Promise<ExistingCompany | null> {
  const { data: bySlug } = await supabase
    .from('companies')
    .select(IDENTITY_COLUMNS)
    .eq('user_id', userId)
    .eq('slug', slugify(candidate.name))
    .maybeSingle();
  if (bySlug) return bySlug as unknown as ExistingCompany;

  const { data: all } = await supabase.from('companies').select(IDENTITY_COLUMNS).eq('user_id', userId);
  const match = findSameCompany(candidate, (all ?? []) as unknown as ExistingCompany[]);
  return match?.company ?? null;
}

/**
 * Settle a company this call has just inserted against any twin inserted at
 * the same moment, and return the id to use.
 *
 * Looking first does not stop two writers racing: the inbox reads a batch of
 * mail at once, and Dasgreenhaus and Das GreenHaus were inserted 15ms apart
 * by two messages from the same sender, each having looked and found nothing.
 * So after inserting, the new row checks again. If an older row is the same
 * company, the new one is still empty and is deleted, and the older one is
 * used. Both racers apply the same rule (the oldest row wins, then the lower
 * id), so they converge on one row rather than each deleting the other.
 */
export async function settleNewCompany(
  supabase: AppSupabaseClient,
  userId: string,
  createdId: string,
): Promise<string> {
  const { data } = await supabase
    .from('companies')
    .select(`${IDENTITY_COLUMNS}, created_at`)
    .eq('user_id', userId);
  const rows = (data ?? []) as unknown as Array<ExistingCompany & { created_at: string }>;
  const mine = rows.find((row) => row.id === createdId);
  if (!mine) return createdId;

  const older = rows.filter(
    (row) =>
      row.id !== mine.id &&
      (row.created_at < mine.created_at || (row.created_at === mine.created_at && row.id < mine.id)),
  );
  const twin = findSameCompany(mine, older);
  if (!twin) return createdId;

  await supabase.from('companies').delete().eq('id', createdId).eq('user_id', userId);
  return twin.company.id;
}

/**
 * Find or create a company by name, filling in domains from the URL we have.
 *
 * Shared rather than duplicated: creating a role and moving one to the company
 * it actually belongs to are the same question -- "which company is this?" --
 * and a second copy of the answer is how two paths end up disagreeing about
 * what counts as the same company.
 *
 * `created` is true only when this call made the row, which is what an undo
 * may delete. A caller that guessed by slug would delete Heron Data on undo
 * after a "Heron" was filed under it.
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
): Promise<{ id: string; error: string | null; created: boolean }> {
  const slug = slugify(name);
  // A careers link on a board says nothing about the employer's own domain.
  const domain = employerDomain(hints.website, name) ?? employerDomain(hints.careersUrl, name);

  const existing = await findExistingCompany(supabase, userId, {
    name,
    domains: domain ? [domain] : [],
    website: hints.website ?? null,
    ats_type: hints.ats ?? null,
    ats_board_token: hints.boardToken ?? null,
  });

  if (existing) {
    // Top up what we learned without clobbering anything the user edited.
    const patch: Record<string, unknown> = {};
    if (domain && !(existing.domains ?? []).includes(domain)) {
      patch.domains = [...(existing.domains ?? []), domain];
    }
    if (hints.boardToken && !existing.ats_board_token) patch.ats_board_token = hints.boardToken;
    if (Object.keys(patch).length > 0) {
      await supabase.from('companies').update(patch).eq('id', existing.id);
    }
    return { id: existing.id, error: null, created: false };
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

  if (error || !data) {
    return { id: '', error: error?.message ?? 'Could not create the company.', created: false };
  }
  const settled = await settleNewCompany(supabase, userId, data.id as string);
  return { id: settled, error: null, created: settled === data.id };
}
