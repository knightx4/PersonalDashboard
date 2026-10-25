/**
 * Workday board tokens, read from career site links (plan #2535.1).
 *
 * A Workday board is named by three things: the tenant, the data centre it is
 * served from (`wd1`, `wd5`, …) and the career site. All three are in the
 * link a company publishes, `https://citi.wd5.myworkdayjobs.com/en-US/2`, and
 * none of them can be guessed from the company's name, so a Workday board is
 * only ever taken from such a link.
 *
 * The token stores them together as `tenant/wdN/site` (`citi/wd5/2`), which is
 * what `companies.ats_board_token` and `watchlist_startups.board_token` hold.
 *
 * Pure, so lib/jobs/ats/detect.ts and lib/jobs/discover/boards.ts can share it.
 * Only `*.wdN.myworkdayjobs.com` links are read; the `wdN.myworkdaysite.com`
 * form keeps the tenant in the path and is not handled yet.
 */

export type WorkdayBoard = { tenant: string; wd: string; site: string };

const HOST = /^([a-z0-9][a-z0-9-]*)\.(wd\d{1,3})\.myworkdayjobs\.com$/i;
const TENANT = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const WD = /^wd\d{1,3}$/i;
const SITE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
/** Workday's locales always carry a region: en-US, fr-CA, zh-CN. */
const LOCALE = /^[a-z]{2}-[a-z]{2,4}$/i;
/** Path segments of Workday's own pages, never a site's name. */
const NOT_SITES = new Set(['job', 'jobs', 'details', 'login', 'apply', 'wday', 'userhome', 'search', 'introduceyourself']);

export function workdayToken(board: WorkdayBoard): string {
  return `${board.tenant}/${board.wd}/${board.site}`;
}

/** The board a stored token names, or null when the token is not one. */
export function parseWorkdayToken(token: string | null | undefined): WorkdayBoard | null {
  if (!token) return null;
  const parts = token.split('/');
  if (parts.length !== 3) return null;
  const [tenant, wd, site] = parts;
  if (!TENANT.test(tenant) || !WD.test(wd) || !SITE.test(site) || NOT_SITES.has(site.toLowerCase())) return null;
  return { tenant: tenant.toLowerCase(), wd: wd.toLowerCase(), site };
}

function segmentsOf(path: string): string[] {
  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}

/**
 * The board and posting a Workday link names. Null when the host is not a
 * tenant's `myworkdayjobs.com` host; `board` is null when the path names no
 * career site (the tenant's root, or a Workday page such as /login).
 *
 * The posting id is the path after `/job/` (`London/Analyst_261002352`), which
 * is also what the board listing returns as each posting's id.
 */
export function workdayFromUrl(url: URL): { board: WorkdayBoard | null; jobId: string | null } | null {
  const host = url.hostname.toLowerCase().match(HOST);
  if (!host) return null;
  const segments = segmentsOf(url.pathname);

  let tenant = host[1];
  let index = 0;
  if (segments[0]?.toLowerCase() === 'wday' && segments[1]?.toLowerCase() === 'cxs') {
    // The API path the career site itself calls: /wday/cxs/{tenant}/{site}/…
    tenant = segments[2] ?? tenant;
    index = 3;
  } else if (segments[0] && LOCALE.test(segments[0])) {
    index = 1;
  }

  const site = segments[index];
  const board = site ? parseWorkdayToken(`${tenant}/${host[2]}/${site}`) : null;
  const rest = segments.slice(index + 1);
  const jobId = board && rest[0]?.toLowerCase() === 'job' && rest.length >= 2 ? rest.slice(1).join('/') : null;
  return { board, jobId };
}
