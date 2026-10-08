/**
 * Fetching the two hiring lists and the person's rules for them (plan #1681).
 * The parsing and the filter are pure (feeds.ts, filter.ts); this is the part
 * that touches the network and the database, for the weekly discovery run.
 *
 * Both feeds are free and keyless and are read through the guarded fetch in
 * lib/jobs/ats/ssrf.ts. A feed that fails throws: the run that calls this
 * decides whether one list is enough to go on with.
 */
import 'server-only';

import { safeFetch } from '@/lib/jobs/ats/ssrf';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { companyKey } from '@/lib/jobs/suggest/payload';
import { readPreferences } from '@/lib/jobs/suggest/preferences';
import {
  HN_THREAD_SEARCH_URL,
  YC_HIRING_URL,
  hnItemUrl,
  parseHnThread,
  parseYcHiring,
  pickWhoIsHiringThread,
  websiteDomain,
  type HnCandidate,
  type HnThread,
  type YcCandidate,
} from './feeds';
import { filterHiringLists, type DiscoveryRules, type FilteredHiringLists } from './filter';

/** The YC list is about 2.6 MB and a hiring thread up to about 1.5 MB. */
const FEED_MAX_BYTES = 8_000_000;

async function fetchJson(url: string, what: string): Promise<unknown> {
  const { status, body } = await safeFetch(url, { maxBytes: FEED_MAX_BYTES, headers: { Accept: 'application/json' } });
  if (status !== 200) throw new Error(`${what} answered ${status}.`);
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error(`${what} did not return JSON.`);
  }
}

/** Every company on YC's hiring list. */
export async function fetchYcHiring(): Promise<YcCandidate[]> {
  return parseYcHiring(await fetchJson(YC_HIRING_URL, 'The YC hiring list'));
}

/** The posts in the newest "Who is hiring?" thread, with the thread they came from. */
export async function fetchLatestWhoIsHiring(): Promise<{ thread: HnThread | null; posts: HnCandidate[] }> {
  const thread = pickWhoIsHiringThread(await fetchJson(HN_THREAD_SEARCH_URL, 'The Hacker News search'));
  if (!thread) return { thread: null, posts: [] };
  return { thread, posts: parseHnThread(await fetchJson(hnItemUrl(thread.id), 'The Hacker News thread')) };
}

type Row = Record<string, unknown>;

/** The person's preferences, excluded industries, companies on file and companies turned down. */
export async function loadDiscoveryRules(supabase: AppSupabaseClient, userId: string): Promise<DiscoveryRules> {
  const [profile, companies, passed] = await Promise.all([
    supabase
      .from('profiles')
      .select('excluded_industries, home_location, workplace_preferences, salary_floor_cents, company_stages')
      .eq('id', userId)
      .maybeSingle(),
    supabase.from('companies').select('name, website, domains').eq('user_id', userId).limit(5000),
    supabase
      .from('suggestions')
      .select('company_name')
      .eq('user_id', userId)
      .eq('kind', 'apply')
      .eq('status', 'dismissed')
      .eq('dismiss_reason', 'company')
      .limit(2000),
  ]);
  if (profile.error) throw new Error(`Reading the job preferences failed: ${profile.error.message}`);
  if (companies.error) throw new Error(`Reading the companies failed: ${companies.error.message}`);
  if (passed.error) throw new Error(`Reading the turned-down companies failed: ${passed.error.message}`);

  const p = (profile.data ?? {}) as Row;
  const knownCompanies = new Set<string>();
  const knownDomains = new Set<string>();
  for (const row of (companies.data ?? []) as Row[]) {
    const key = companyKey(row.name as string | null);
    if (key) knownCompanies.add(key);
    const site = websiteDomain(row.website as string | null);
    if (site) knownDomains.add(site);
    for (const domain of Array.isArray(row.domains) ? (row.domains as unknown[]) : []) {
      const host = typeof domain === 'string' ? websiteDomain(domain) : null;
      if (host) knownDomains.add(host);
    }
  }
  const passedCompanies = new Set<string>();
  for (const row of (passed.data ?? []) as Row[]) {
    const key = companyKey(row.company_name as string | null);
    if (key) passedCompanies.add(key);
  }
  return {
    preferences: readPreferences(p),
    excludedIndustries: Array.isArray(p.excluded_industries) ? (p.excluded_industries as string[]) : [],
    knownCompanies,
    knownDomains,
    passedCompanies,
  };
}

/** Both lists, read and filtered for one person. */
export async function readHiringLists(
  supabase: AppSupabaseClient,
  userId: string,
): Promise<FilteredHiringLists & { thread: HnThread | null }> {
  const [rules, yc, hn] = await Promise.all([
    loadDiscoveryRules(supabase, userId),
    fetchYcHiring(),
    fetchLatestWhoIsHiring(),
  ]);
  return { ...filterHiringLists({ yc, hn: hn.posts }, rules), thread: hn.thread };
}
