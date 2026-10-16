/**
 * Whether two company rows are the same employer.
 *
 * Pure, so the write paths that create companies, the duplicate list on the
 * Companies page and the merge picker all give the same answer. Heron and
 * Heron Data were one employer recorded twice: the board import named it from
 * its Ashby board, Find named it from its website, and creating a company
 * matched on the slug alone, so "heron" and "heron-data" never met.
 *
 * Three signals, most certain first:
 *
 *   board   the same ATS vendor and board token. A board belongs to one
 *           employer, so this is decisive.
 *   domain  an employer domain in common, read from `domains` and the
 *           website. Board and job-site hosts never count (isSharedHost).
 *   name    the same name once legal suffixes and filler words come off
 *           ("Heron Data" and "Heron", "Acme, Inc." and "Acme"). The weakest:
 *           write paths act on it only when it picks out one company.
 */

import { slugify } from '@/lib/jobs/slug';

/**
 * Board and job-site hosts: they carry many employers' pages, so none of them
 * is any one employer's domain. Mirrors job_search.is_shared_host in
 * supabase/migrations-job-search/0056_board_hosts_out_of_domains.sql.
 */
const SHARED_HOST =
  /(^|\.)(greenhouse\.io|greenhouse-mail\.io|lever\.co|ashbyhq\.com|myworkday\.com|myworkdayjobs\.com|workday\.com|icims\.com|smartrecruiters\.com|workable\.com|workablemail\.com|taleo\.net|oraclecloud\.com|jobvite\.com|bamboohr\.com|breezy\.hr|recruitee\.com|rippling\.com|wellfound\.com|angel\.co|linkedin\.com|indeed\.com|glassdoor\.com|gem\.com|dover\.com|dover\.io|pinpointhq\.com|teamtailor\.com|applytojob\.com|jazzhr\.com|paylocity\.com|ultipro\.com|adp\.com|ycombinator\.com|workatastartup\.com|welcometothejungle\.com|otta\.com|notion\.site|google\.com|builtin[a-z]*\.com)$/i;

function compact(name: string | null | undefined): string {
  return (name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Whether a host is a board or job site rather than an employer's own. The
 * company's name is the exception: rippling.com is Rippling's own domain even
 * though Rippling is also a board.
 */
export function isSharedHost(host: string, companyName?: string | null): boolean {
  const value = host.trim().toLowerCase();
  if (!SHARED_HOST.test(value)) return false;
  const own = compact(companyName);
  if (own && new RegExp(`(^|\\.)${own}\\.[a-z.]+$`).test(value)) return false;
  return true;
}

/** The host of a URL or bare domain, without `www.`, or null. */
export function hostOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  try {
    const host = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`).hostname;
    const bare = host.replace(/^www\./, '');
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(bare) ? bare : null;
  } catch {
    return null;
  }
}

/**
 * The employer's domain a URL gives, or null when the URL is on a board.
 *
 * `domainFromUrl` alone turned a careers link on jobs.ashbyhq.com into the
 * company's domain, which is how 28 companies came to hold one.
 */
export function employerDomain(
  url: string | null | undefined,
  companyName?: string | null,
): string | null {
  const host = hostOf(url);
  if (!host || isSharedHost(host, companyName)) return null;
  return host;
}

/**
 * Words that sit after a company's name without telling two companies apart.
 * Taken off the end only, and never the last word left.
 */
const TRAILING_FILLER = new Set([
  'inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company', 'plc',
  'gmbh', 'ag', 'sa', 'lp', 'llp', 'holdings', 'group', 'technologies', 'technology', 'tech',
  'labs', 'lab', 'hq', 'ai', 'data', 'software', 'systems', 'app', 'io', 'global', 'international',
]);

/**
 * A company's name reduced to what identifies it: lower case, no
 * punctuation, a leading "the" and trailing legal or filler words removed,
 * then joined. "Heron Data" and "Heron" both give "heron"; "D. E. Shaw & Co."
 * gives "deshaw".
 */
export function companyNameKey(name: string | null | undefined): string {
  const words = slugify(name ?? '')
    .split('-')
    .filter(Boolean);
  if (words[0] === 'the' && words.length > 1) words.shift();
  while (words.length > 1 && TRAILING_FILLER.has(words[words.length - 1]!)) words.pop();
  // Initials written with stops ("d e shaw") are one word, not three.
  return words.join('');
}

export interface CompanyIdentity {
  id?: string;
  name: string;
  domains?: readonly string[] | null;
  website?: string | null;
  ats_type?: string | null;
  ats_board_token?: string | null;
}

export type SameCompanyReason = 'board' | 'domain' | 'name';

/** The employer domains a row holds: its domains and its website's, boards left out. */
export function employerDomains(company: CompanyIdentity): string[] {
  const found = new Set<string>();
  for (const raw of [...(company.domains ?? []), company.website ?? null]) {
    const host = employerDomain(raw, company.name);
    if (host) found.add(host);
  }
  return [...found];
}

function boardKey(company: CompanyIdentity): string | null {
  const token = company.ats_board_token?.trim().toLowerCase();
  const vendor = company.ats_type?.trim().toLowerCase();
  if (!token || !vendor || vendor === 'unknown') return null;
  return `${vendor}:${token}`;
}

function sharesDomain(a: readonly string[], b: readonly string[]): boolean {
  return a.some((x) => b.some((y) => x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`)));
}

/** Why two rows are the same employer, the strongest reason first, or null. */
export function sameCompany(a: CompanyIdentity, b: CompanyIdentity): SameCompanyReason | null {
  const boardA = boardKey(a);
  if (boardA && boardA === boardKey(b)) return 'board';
  if (sharesDomain(employerDomains(a), employerDomains(b))) return 'domain';
  const nameA = companyNameKey(a.name);
  if (nameA.length >= 3 && nameA === companyNameKey(b.name)) return 'name';
  return null;
}

const STRENGTH: Record<SameCompanyReason, number> = { board: 3, domain: 2, name: 1 };

/**
 * The existing company a new one is, or null.
 *
 * Board and domain are each decisive, so the first row they pick out wins. A
 * name alone is acted on only when exactly one row carries it: two existing
 * rows that both reduce to "heron" are already a duplicate for the person to
 * merge, and guessing between them would file the new row under the wrong one
 * half the time.
 */
export function findSameCompany<T extends CompanyIdentity>(
  candidate: CompanyIdentity,
  existing: readonly T[],
): { company: T; reason: SameCompanyReason } | null {
  let best: { company: T; reason: SameCompanyReason } | null = null;
  let nameMatches = 0;
  for (const company of existing) {
    const reason = sameCompany(candidate, company);
    if (!reason) continue;
    if (reason === 'name') nameMatches += 1;
    if (!best || STRENGTH[reason] > STRENGTH[best.reason]) best = { company, reason };
  }
  if (best?.reason === 'name' && nameMatches > 1) return null;
  return best;
}

export interface DuplicatePair<T> {
  a: T;
  b: T;
  reason: SameCompanyReason;
}

/** Every pair of rows that look like one employer, strongest reasons first. */
export function duplicatePairs<T extends CompanyIdentity>(companies: readonly T[]): DuplicatePair<T>[] {
  const pairs: DuplicatePair<T>[] = [];
  for (let i = 0; i < companies.length; i += 1) {
    for (let j = i + 1; j < companies.length; j += 1) {
      const reason = sameCompany(companies[i]!, companies[j]!);
      if (reason) pairs.push({ a: companies[i]!, b: companies[j]!, reason });
    }
  }
  return pairs.sort((x, y) => STRENGTH[y.reason] - STRENGTH[x.reason]);
}
