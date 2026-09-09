import 'server-only';

import { createClient } from '@/lib/jobs/auth/server';
import type { SearchContext, SearchHit, SearchSource } from '@/lib/search/sources';
import { companyHit, contactHit, embedded, escapeLike, roleHit } from '@/lib/search/sources/map';

/**
 * The job search, in the command palette.
 *
 * One client, bound to `job_search`, and three reads over it. Every query goes
 * through the session client, so RLS decides what comes back and nothing here
 * filters by user id -- the same rule as everywhere else, and the reason a
 * search across five schemas does not need a single ownership check of its
 * own.
 *
 * Names only. That was decided on the feature: names and titles now, note
 * bodies later, and the difference is a migration per schema rather than an
 * ilike.
 */

const contains = (query: string) => `%${escapeLike(query)}%`;

async function findCompanies(ctx: SearchContext): Promise<SearchHit[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('companies')
    .select('id, name, slug, industry')
    .ilike('name', contains(ctx.query))
    .order('updated_at', { ascending: false })
    .limit(ctx.limit);

  if (error) throw new Error(`companies: ${error.message}`);

  return ((data ?? []) as {
    id: string;
    name: string;
    slug: string | null;
    industry: string | null;
  }[]).map(companyHit);
}

async function findRoles(ctx: SearchContext): Promise<SearchHit[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('roles')
    .select('id, title, location, companies(name)')
    .ilike('title', contains(ctx.query))
    .order('updated_at', { ascending: false })
    .limit(ctx.limit);

  if (error) throw new Error(`roles: ${error.message}`);

  return ((data ?? []) as unknown as {
    id: string;
    title: string;
    location: string | null;
    companies: { name: string } | { name: string }[] | null;
  }[]).map((row) => roleHit({ id: row.id, title: row.title, company: embedded(row.companies) }));
}

async function findContacts(ctx: SearchContext): Promise<SearchHit[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('contacts')
    .select('id, full_name, title, companies(name)')
    .ilike('full_name', contains(ctx.query))
    .order('updated_at', { ascending: false })
    .limit(ctx.limit);

  if (error) throw new Error(`contacts: ${error.message}`);

  return ((data ?? []) as unknown as {
    id: string;
    full_name: string;
    title: string | null;
    companies: { name: string } | { name: string }[] | null;
  }[]).map((row) =>
    contactHit({
      id: row.id,
      full_name: row.full_name,
      title: row.title,
      company: embedded(row.companies),
    }),
  );
}

export const jobsSearchSource: SearchSource = {
  id: 'jobs',
  module: 'jobs',
  label: 'Job search',
  async find(ctx) {
    // Three reads on one schema, together. A failure in any of them fails the
    // source, which the merge already treats as contributing nothing.
    const [companies, roles, contacts] = await Promise.all([
      findCompanies(ctx),
      findRoles(ctx),
      findContacts(ctx),
    ]);
    return [...companies, ...roles, ...contacts];
  },
};
