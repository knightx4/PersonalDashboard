/**
 * Reads the discovered companies and the latest discovery run for Find
 * (feature #1679). The shapes and the ranking are watchlist-view.ts.
 */
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { JobPreferences } from '@/lib/jobs/suggest/preferences';
import { postingPlaceFits } from './filter';
import { rankCompanies, type DiscoveredCompany, type DiscoveryRunView } from './watchlist-view';

type Row = Record<string, unknown>;

const COLUMNS =
  'id, name, website, source, description, reason, fit_score, stage, locations, posting_roles, board_vendor, board_token, board_checked_at, companies ( slug )';

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
  const { data, error } = await supabase
    .from('watchlist_startups')
    .select(COLUMNS)
    .eq('user_id', userId)
    .order('fit_score', { ascending: false, nullsFirst: false })
    .limit(200);
  if (error) throw new Error(`Reading the discovered companies failed: ${error.message}`);
  const companies: DiscoveredCompany[] = ((data ?? []) as Row[]).map((row) => {
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
