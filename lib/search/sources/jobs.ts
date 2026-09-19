import 'server-only';

import { createClient } from '@/lib/jobs/auth/server';
import type {
  SearchContext,
  SearchHit,
  SearchListContext,
  SearchSource,
} from '@/lib/search/sources';
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
 *
 * `find` and `list` are the same three reads: listing is matching with the
 * `ilike` left off, so both go through the functions below and neither can
 * drift from the other's mapping.
 */

const contains = (query: string) => `%${escapeLike(query)}%`;

/** A search, or -- with no query -- everything. */
type Read = SearchListContext & { query?: string };

async function findCompanies(ctx: Read): Promise<SearchHit[]> {
  const supabase = await createClient();
  let read = supabase.from('companies').select('id, name, slug, industry');
  if (ctx.query) read = read.ilike('name', contains(ctx.query));

  const { data, error } = await read.order('updated_at', { ascending: false }).limit(ctx.limit);

  if (error) throw new Error(`companies: ${error.message}`);

  return ((data ?? []) as {
    id: string;
    name: string;
    slug: string | null;
    industry: string | null;
  }[]).map(companyHit);
}

async function findRoles(ctx: Read): Promise<SearchHit[]> {
  const supabase = await createClient();
  let read = supabase.from('roles').select('id, title, location, companies(name)');
  if (ctx.query) read = read.ilike('title', contains(ctx.query));

  const { data, error } = await read.order('updated_at', { ascending: false }).limit(ctx.limit);

  if (error) throw new Error(`roles: ${error.message}`);

  return ((data ?? []) as unknown as {
    id: string;
    title: string;
    location: string | null;
    companies: { name: string } | { name: string }[] | null;
  }[]).map((row) => roleHit({ id: row.id, title: row.title, company: embedded(row.companies) }));
}

async function findContacts(ctx: Read): Promise<SearchHit[]> {
  const supabase = await createClient();
  let read = supabase.from('contacts').select('id, full_name, title, companies(name)');
  if (ctx.query) read = read.ilike('full_name', contains(ctx.query));

  const { data, error } = await read.order('updated_at', { ascending: false }).limit(ctx.limit);

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

// Three reads on one schema, together. A failure in any of them fails the
// source, which the merge already treats as contributing nothing.
async function read(ctx: Read): Promise<SearchHit[]> {
  const [companies, roles, contacts] = await Promise.all([
    findCompanies(ctx),
    findRoles(ctx),
    findContacts(ctx),
  ]);
  return [...companies, ...roles, ...contacts];
}

export const jobsSearchSource: SearchSource = {
  id: 'jobs',
  module: 'jobs',
  label: 'Job search',
  kinds: ['company', 'role', 'contact'],
  find(ctx: SearchContext) {
    return read(ctx);
  },
  list(ctx: SearchListContext) {
    return read(ctx);
  },
};
