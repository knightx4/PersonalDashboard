/**
 * Finding the job board of every company on file (plan #2535.2).
 *
 * The roles search reads the boards of the companies the person follows
 * (lib/jobs/suggest/boards.ts), but most companies arrived through the inbox
 * with a name and a sender's domain and no board, so their roles were only
 * ever found by web search. This looks for each one's board the way startup
 * discovery does (findBoard in ./boards.ts): only from a link the company
 * published on its own site, never guessed from its name.
 *
 * Most of these rows have no website. One is taken first from the domains
 * already on the row, when a domain's name is the company's own (a sender's
 * domain can be a vendor's mail host, such as zenity.comeet-notifications.com),
 * then from Wikidata (lib/jobs/enrich), when its official website matches a
 * domain on the row or exactly one entry carries the company's exact name. A
 * company with neither is stamped as checked and waits for the next look.
 *
 * Recruiting agencies and rows named Stealth Startup are left out: neither
 * has roles to apply to directly. Most rows have no industry, so an agency is
 * also known by its name ("Arrow Search Partners", "Cobalt Recruitment").
 *
 * A found board is written with its vendor, token and the check's time in one
 * update; a miss writes only the time, so the company waits RECHECK_DAYS.
 * Nothing else on the row is written: the website a look used is not kept,
 * since a name match from Wikidata is not something to file without asking.
 */
import 'server-only';

import { isBoardVendor } from '@/lib/jobs/ats/detect';
import { companyNameKey, employerDomain, hostOf, isSharedHost } from '@/lib/jobs/companies/same-company';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { rankCandidates } from '@/lib/jobs/enrich/company';
import { createWikidataCompanyProvider, type WikidataCompany } from '@/lib/jobs/enrich/wikidata';
import { slugify } from '@/lib/jobs/slug';
import { BOARDS_PER_RUN, LIVE_IO, RECHECK_DAYS, findBoard, type BoardIo, type FoundBoard } from './boards';

/** Companies looked at at once. */
const PARALLEL = 4;
/** No new batch starts with less than this left; one company can take several twelve-second reads. */
const RESERVE_MS = 40_000;
const DEFAULT_BUDGET_MS = 150_000;
/** Rows read to choose the day's batch from; the agencies among them are dropped first. */
const CANDIDATE_ROWS = 1_000;

const AGENCY_INDUSTRY = /\b(staffing|recruit(ing|ment|ers?)?|executive search|headhunt\w*)\b/i;
const AGENCY_NAME =
  /\b(recruit(ing|ment|ers?)?|staffing|search|talent|headhunt(ers?|ing)?|personnel)\b/i;
const STEALTH = /^\s*stealth(\s+(startup|mode|company|co))?\s*$/i;

/**
 * Whether a company is a recruiting agency (or a company's recruiting team
 * filed as a company), or a stealth placeholder. `\bsearch\b` matches
 * "Glocap Search" and "Search & Selection" but not "Lam Research".
 */
export function isSkippedCompany(row: { name: string; industry: string | null }): boolean {
  if (STEALTH.test(row.name)) return true;
  if (row.industry && AGENCY_INDUSTRY.test(row.industry)) return true;
  return AGENCY_NAME.test(row.name);
}

/** The registrable part of a host, naively: two labels, or three under a country's second level (co.uk). */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const tld = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  const take = tld.length === 2 && /^(co|com|ac|org|net|gov|ltd)$/.test(second) ? 3 : 2;
  return labels.slice(-take).join('.');
}

/** Whether a domain's name is the company's: its own name, containing it, or its initials. */
export function domainNamesCompany(domain: string, companyName: string): boolean {
  const label = registrableDomain(domain).split('.')[0].replace(/-/g, '');
  const key = companyNameKey(companyName);
  if (!label || !key) return false;
  if (label === key) return true;
  if (key.length >= 3 && label.includes(key)) return true;
  if (label.length >= 4 && key.startsWith(label)) return true;
  const words = slugify(companyName).split('-').filter(Boolean);
  const initials = words.map((word) => word[0]).join('');
  return words.length >= 2 && label.length >= 2 && label === initials;
}

/** A website for the company from the domains on its row, or null when none is its own. */
export function websiteFromDomains(companyName: string, domains: readonly string[] | null): string | null {
  for (const raw of domains ?? []) {
    const host = hostOf(raw);
    if (!host || isSharedHost(host, companyName)) continue;
    if (!domainNamesCompany(host, companyName)) continue;
    return `https://${registrableDomain(host)}`;
  }
  return null;
}

/**
 * The website Wikidata gives, or null. Taken when the entry's website
 * matches a domain on the row, or when exactly one entry with a website
 * carries the company's exact name; anything looser is a guess.
 */
export function websiteFromWikidata(
  company: { name: string; domains: readonly string[] | null },
  candidates: readonly WikidataCompany[],
): string | null {
  const usable = candidates.filter(
    (candidate) => candidate.websiteUrl && candidate.websiteDomain && !isSharedHost(candidate.websiteDomain),
  );
  const [best] = rankCandidates(usable, { name: company.name, domains: company.domains ?? [] });
  if (best?.verified) return best.company.websiteUrl;
  const key = companyNameKey(company.name);
  const exact = usable.filter((candidate) => companyNameKey(candidate.label) === key);
  return exact.length === 1 ? exact[0].websiteUrl : null;
}

/** Looks a company's website up by name; null when nothing trustworthy is found. */
export type SiteLookup = (company: { name: string; domains: readonly string[] | null }) => Promise<string | null>;

export const WIKIDATA_LOOKUP: SiteLookup = async (company) => {
  try {
    const candidates = await createWikidataCompanyProvider().searchCompanies(company.name);
    return websiteFromWikidata(company, candidates);
  } catch {
    // Wikidata down is the same as Wikidata not knowing: the next look tries again.
    return null;
  }
};

type CompanyRow = {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  careers_url: string | null;
  domains: string[] | null;
  ats_type: string | null;
  ats_board_token: string | null;
  ats_board_checked_at: string | null;
};

/** Whether the roles search reads this company's board already. */
export function hasReadableBoard(row: { ats_type: string | null; ats_board_token: string | null }): boolean {
  return Boolean(row.ats_board_token) && isBoardVendor(row.ats_type);
}

export type CompanyBoardsOutcome = {
  /** Companies looked at, and of those the ones a board was found for. */
  checked: number;
  found: number;
  /** Of those looked at, the ones with no website from the row or Wikidata. */
  noSite: number;
  /** Companies still due a look when the run stopped. */
  left: number;
};

export type CompanyBoardsOptions = {
  now?: Date;
  /** Epoch milliseconds after which no new batch starts. */
  deadline?: number;
  limit?: number;
  /** Overridable for tests. */
  io?: BoardIo;
  lookupSite?: SiteLookup;
};

async function lookOnce(row: CompanyRow, io: BoardIo, lookupSite: SiteLookup) {
  const website =
    row.website?.trim() ||
    (employerDomain(row.careers_url, row.name) ? row.careers_url : null) ||
    websiteFromDomains(row.name, row.domains) ||
    (await lookupSite({ name: row.name, domains: row.domains }));
  if (!website) return { board: null as FoundBoard | null, site: false };
  // A careers page on the company's own site reads as its site in findBoard.
  const result = await findBoard({ website, postingUrl: row.careers_url ?? null }, io);
  return { board: result.board, site: true };
}

/**
 * One person's companies: look for a board for each that has none Dash reads
 * and was not checked in the last four weeks, newest updated first, and write
 * what was found. Every read and write names the person.
 */
export async function findCompanyBoards(
  supabase: AppSupabaseClient,
  userId: string,
  options: CompanyBoardsOptions = {},
): Promise<CompanyBoardsOutcome> {
  const now = options.now ?? new Date();
  const io = options.io ?? LIVE_IO;
  const lookupSite = options.lookupSite ?? WIKIDATA_LOOKUP;
  const deadline = options.deadline ?? Date.now() + DEFAULT_BUDGET_MS;
  const cutoff = new Date(now.getTime() - RECHECK_DAYS * 86_400_000).toISOString();

  const { data, error } = await supabase
    .from('companies')
    .select('id, name, industry, website, careers_url, domains, ats_type, ats_board_token, ats_board_checked_at')
    .eq('user_id', userId)
    .or(`ats_board_checked_at.is.null,ats_board_checked_at.lt.${cutoff}`)
    .order('updated_at', { ascending: false })
    .limit(CANDIDATE_ROWS);
  if (error) throw new Error(`Reading the companies failed: ${error.message}`);
  const due = ((data ?? []) as CompanyRow[]).filter((row) => !hasReadableBoard(row) && !isSkippedCompany(row));
  const batchRows = due.slice(0, options.limit ?? BOARDS_PER_RUN);

  let checked = 0;
  let found = 0;
  let noSite = 0;
  for (let i = 0; i < batchRows.length; i += PARALLEL) {
    if (deadline - Date.now() < RESERVE_MS) break;
    const batch = batchRows.slice(i, i + PARALLEL);
    const results = await Promise.all(batch.map((row) => lookOnce(row, io, lookupSite)));
    for (const [index, result] of results.entries()) {
      const row = batch[index];
      const patch = result.board
        ? { ats_type: result.board.vendor, ats_board_token: result.board.token, ats_board_checked_at: now.toISOString() }
        : { ats_board_checked_at: now.toISOString() };
      const update = await supabase.from('companies').update(patch).eq('id', row.id).eq('user_id', userId);
      if (update.error) throw new Error(`Writing the board for ${row.name} failed: ${update.error.message}`);
      checked += 1;
      if (result.board) found += 1;
      if (!result.site) noSite += 1;
    }
  }
  return { checked, found, noSite, left: due.length - checked };
}
