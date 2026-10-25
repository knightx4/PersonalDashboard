/**
 * The shapes of the two services most investors' portfolio job boards run on
 * (plan #2535.4), kept apart from the fetching so they are tested on saved
 * responses. The reads are portfolio.ts.
 *
 * Getro: `POST https://api.getro.com/api/v2/collections/<id>/search/jobs`
 * with `{ hitsPerPage, page, filters, query }` and `Accept: application/json`
 * (without it the answer is 406). It returns twenty postings a page whatever
 * `hitsPerPage` says, newest first by `created_at` (seconds), each naming its
 * company under `organization`.
 *
 * Consider: the board's own host serves `POST /api-boards/search-jobs`,
 * which answers 412 INVALID_CSRF unless the call carries the session cookie
 * and the `X-CSRF-Token` that the board's /jobs page sets and prints in
 * `window.serverInitialData`, along with the board's id. `query.postedSince`
 * takes an ISO duration (the page offers P1D, P7D, P30D), and `meta.sequence`
 * pages on, up to a hundred postings a page.
 */

export type PortfolioHost = 'getro' | 'consider';
export const PORTFOLIO_HOSTS: readonly PortfolioHost[] = ['getro', 'consider'];

export function isPortfolioHost(value: unknown): value is PortfolioHost {
  return value === 'getro' || value === 'consider';
}

/** One posting on a portfolio board: the company is the posting's own, not the investor. */
export type PortfolioPosting = {
  title: string;
  url: string;
  location: string | null;
  company: string;
  /** When the board says it went up, as ISO; null when it does not say. */
  postedAt: string | null;
};

type Row = Record<string, unknown>;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Getro's page of postings. `boardUrl` makes a link for a posting that names no source link. */
export function getroPostings(body: unknown, boardUrl: string | null): { postings: PortfolioPosting[]; total: number | null } {
  const results = ((body as Row | null)?.results ?? null) as Row | null;
  const jobs = Array.isArray(results?.jobs) ? (results.jobs as Row[]) : [];
  const postings: PortfolioPosting[] = [];
  for (const job of jobs) {
    const title = text(job.title);
    const organization = (job.organization ?? null) as Row | null;
    const company = text(organization?.name);
    const slug = text(job.slug);
    const orgSlug = text(organization?.slug);
    const url =
      text(job.url) ?? (boardUrl && slug && orgSlug ? `${boardUrl.replace(/\/+$/, '')}/companies/${orgSlug}/jobs/${slug}` : null);
    if (!title || !company || !url) continue;
    const locations = Array.isArray(job.locations) ? (job.locations as unknown[]).map(text).filter(Boolean) : [];
    const created = typeof job.created_at === 'number' ? new Date(job.created_at * 1000).toISOString() : null;
    postings.push({ title, url, company, location: locations.length ? locations.join('; ') : null, postedAt: created });
  }
  return { postings, total: typeof results?.count === 'number' ? results.count : null };
}

/**
 * Whether Getro's newest-first pages can stop: the page came back short, or
 * its oldest posting went up before `since`.
 */
export function getroDone(page: readonly PortfolioPosting[], since: Date): boolean {
  if (page.length === 0) return true;
  const oldest = page[page.length - 1].postedAt;
  return oldest !== null && new Date(oldest).getTime() < since.getTime();
}

/** What a Consider board's /jobs page gives a reader: the CSRF token and the board it names. */
export function considerSession(html: string): { csrf: string; board: { id: string; isParent: boolean } } | null {
  const csrf = /"csrfToken"\s*:\s*"([^"]+)"/.exec(html)?.[1];
  const board = /"board"\s*:\s*\{\s*"id"\s*:\s*"([^"]+)"\s*,\s*"isParent"\s*:\s*(true|false)/.exec(html);
  if (!csrf || !board) return null;
  return { csrf, board: { id: board[1], isParent: board[2] === 'true' } };
}

/** Consider's page of postings and the sequence for the next one. */
export function considerPostings(body: unknown): { postings: PortfolioPosting[]; sequence: string | null } {
  const root = (body ?? null) as Row | null;
  const jobs = Array.isArray(root?.jobs) ? (root.jobs as Row[]) : [];
  const postings: PortfolioPosting[] = [];
  for (const job of jobs) {
    const title = text(job.title);
    const company = text(job.companyName);
    const url = text(job.url) ?? text(job.applyUrl);
    if (!title || !company || !url) continue;
    const locations = Array.isArray(job.locations) ? (job.locations as unknown[]).map(text).filter(Boolean) : [];
    const stamp = text(job.timeStamp);
    const posted = stamp && !Number.isNaN(Date.parse(stamp)) ? new Date(stamp).toISOString() : null;
    postings.push({ title, url, company, location: locations.length ? locations.join('; ') : null, postedAt: posted });
  }
  const meta = (root?.meta ?? null) as Row | null;
  return { postings, sequence: text(meta?.sequence) };
}

/** Postings that went up at or after `since`; one that gives no date is kept, and the diff tells it from the known. */
export function postedSince(postings: readonly PortfolioPosting[], since: Date): PortfolioPosting[] {
  return postings.filter((posting) => !posting.postedAt || new Date(posting.postedAt).getTime() >= since.getTime());
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far back a read looks: a day before the last read, and never more than a week. */
export const LOOK_BACK_DAYS = 7;
const OVERLAP_DAYS = 1;

/** The earliest posting date a read keeps: a week on the first read, else a day before the last one. */
export function readSince(readAt: string | null, now: Date): Date {
  const floor = now.getTime() - LOOK_BACK_DAYS * DAY_MS;
  if (!readAt) return new Date(floor);
  return new Date(Math.max(floor, new Date(readAt).getTime() - OVERLAP_DAYS * DAY_MS));
}

/** "RRE Ventures'" and "Antler's". */
export function possessive(name: string): string {
  return /s$/i.test(name.trim()) ? `${name.trim()}'` : `${name.trim()}'s`;
}
