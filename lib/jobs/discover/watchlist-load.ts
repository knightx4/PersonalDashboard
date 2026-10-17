/**
 * Reads the discovered companies and the latest discovery run for Find
 * (feature #1679). The shapes and the ranking are watchlist-view.ts.
 */
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { JobPreferences } from '@/lib/jobs/suggest/preferences';
import { employerDomain, findSameCompany, type CompanyIdentity } from '@/lib/jobs/companies/same-company';
import { postingPlaceFits } from './filter';
import { rankCompanies, type DiscoveredCompany, type DiscoveryRunView } from './watchlist-view';

type Row = Record<string, unknown>;

const COLUMNS =
  'id, name, website, source, description, reason, fit_score, stage, locations, posting_roles, board_vendor, board_token, board_checked_at, company_id, companies ( slug )';

/** A discovered row as the companies list is asked about it. */
export type DiscoveredIdentity = {
  companyId: string | null;
  name: string;
  website: string | null;
  vendor: string | null;
  token: string | null;
};

/**
 * Whether a discovered company is already on the companies list (note
 * 62b88f19): linked by Add to my companies, or the same company by board,
 * domain or name as one added another way, by the rule that keeps two
 * companies rows from being one company.
 */
export function onCompanies(row: DiscoveredIdentity, companies: readonly CompanyIdentity[]): boolean {
  if (row.companyId) return true;
  const domain = employerDomain(row.website, row.name);
  return (
    findSameCompany(
      { name: row.name, domains: domain ? [domain] : [], website: row.website, ats_type: row.vendor, ats_board_token: row.token },
      companies,
    ) !== null
  );
}

/**
 * A startup whose places suit the preferences, by the rule the hiring lists
 * are filtered with. Rows shortlisted before a home location was set can be
 * anywhere, so the rule is applied again here. One that names no place stays.
 */
export function companyPlaceFits(company: Pick<DiscoveredCompany, 'locations'>, prefs: JobPreferences): boolean {
  return postingPlaceFits(company.locations.join('; ') || null, prefs);
}

export async function loadDiscoveredCompanies(
  supabase: AppSupabaseClient,
  userId: string,
  prefs: JobPreferences,
): Promise<DiscoveredCompany[]> {
  const [{ data, error }, { data: known, error: knownError }] = await Promise.all([
    supabase
      .from('watchlist_startups')
      .select(COLUMNS)
      .eq('user_id', userId)
      .order('fit_score', { ascending: false, nullsFirst: false })
      .limit(200),
    supabase.from('companies').select('id, name, domains, website, ats_type, ats_board_token').eq('user_id', userId),
  ]);
  if (error) throw new Error(`Reading the discovered companies failed: ${error.message}`);
  if (knownError) throw new Error(`Reading the companies failed: ${knownError.message}`);
  const followed = (known ?? []) as unknown as CompanyIdentity[];
  const fresh = ((data ?? []) as Row[]).filter(
    (row) =>
      !onCompanies(
        {
          companyId: (row.company_id as string | null) ?? null,
          name: row.name as string,
          website: (row.website as string | null) ?? null,
          vendor: (row.board_vendor as string | null) ?? null,
          token: (row.board_token as string | null) ?? null,
        },
        followed,
      ),
  );
  const companies: DiscoveredCompany[] = fresh.map((row) => {
    const company = (Array.isArray(row.companies) ? row.companies[0] : row.companies) as Row | null;
    const vendor = row.board_vendor as string | null;
    return {
      id: row.id as string,
      name: row.name as string,
      website: (row.website as string | null) ?? null,
      source: row.source === 'hn' ? 'hn' : 'yc',
      description: (row.description as string | null) ?? null,
      reason: (row.reason as string | null) ?? null,
      score: (row.fit_score as number | null) ?? null,
      stage: (row.stage as string | null) ?? null,
      locations: (row.locations as string[] | null) ?? [],
      postingRoles: (row.posting_roles as string[] | null) ?? [],
      board: vendor && row.board_token ? { vendor } : null,
      noBoard: !vendor && !!row.board_checked_at,
      companySlug: (company?.slug as string | undefined) ?? null,
    };
  });
  return rankCompanies(companies.filter((company) => companyPlaceFits(company, prefs)));
}

export async function loadLatestDiscoveryRun(
  supabase: AppSupabaseClient,
  userId: string,
): Promise<DiscoveryRunView | null> {
  const { data, error } = await supabase
    .from('discovery_runs')
    .select('stage, started_at, finished_at, offered, added, refreshed, boards_found, error')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Row;
  return {
    stage: row.stage as string,
    startedAt: row.started_at as string,
    finishedAt: (row.finished_at as string | null) ?? null,
    offered: (row.offered as number) ?? 0,
    added: (row.added as number) ?? 0,
    refreshed: (row.refreshed as number) ?? 0,
    boardsFound: (row.boards_found as number) ?? 0,
    error: (row.error as string | null) ?? null,
  };
}
