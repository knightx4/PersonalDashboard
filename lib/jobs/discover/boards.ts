/**
 * Finding the job board of each startup on the watchlist (plan #1683,
 * feature #1679).
 *
 * A board is only ever taken from a link the company itself published: on its
 * own website (the home page, then its careers or jobs page), or as the apply
 * link in its own Hacker News post. The token is never guessed from the
 * company's name. In testing, a guessed `acme` answered with a different
 * Acme's board, and lib/jobs/ats/discover.ts can only make guessing safe by
 * matching roles we already hold there, which a discovered startup has none of.
 *
 * A board is stored only once it reads (fetchBoard answers), and its vendor
 * and token are written together. A startup with no readable board keeps
 * none and is not looked at again for four weeks (RECHECK_DAYS).
 *
 * Any of the vendors in lib/jobs/ats/board.ts counts, since the roles search
 * reads all of them (lib/jobs/suggest/boards.ts); in practice the links found
 * are Ashby, Greenhouse and Lever.
 */
import 'server-only';

import { fetchBoard } from '@/lib/jobs/ats/board';
import { detectPosting, isBoardVendor, type BoardVendor } from '@/lib/jobs/ats/detect';
import { safeFetch } from '@/lib/jobs/ats/ssrf';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';

/** A startup whose board was looked for and not found waits this long before the next look. */
export const RECHECK_DAYS = 28;
/** Startups looked at in one run. */
export const BOARDS_PER_RUN = 60;
/** Startups looked at at once. */
const PARALLEL = 4;
/** Pages read for one startup: the home page, two careers pages and one more. */
const MAX_PAGES = 4;
/** No new batch starts with less than this left; one startup can take several twelve-second reads. */
const RESERVE_MS = 40_000;
const DEFAULT_BUDGET_MS = 150_000;

export type FoundBoard = {
  vendor: BoardVendor;
  token: string;
  /** The page or post link the board was found on. */
  from: string;
};

/** A board token is a plain slug; anything else is a path segment of the vendor's own site. */
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const NOT_TOKENS = new Set(['embed', 'api', 'v0', 'v1', 'jobs', 'careers', 'job_board', 'posting-api', 'boards']);

const GREENHOUSE_BOARD_HOST = /^(boards|job-boards)(\.eu)?\.greenhouse\.io$/i;
const GREENHOUSE_API = /^\/v1\/boards\/([^/]+)/i;
const LEVER_BOARD_HOST = /^jobs(\.eu)?\.lever\.co$/i;
const LEVER_API = /^\/v0\/postings\/([^/?]+)/i;
const ASHBY_API = /^\/posting-api\/job-board\/([^/?]+)/i;

/**
 * The board a link points at, or null. Narrower than detectPosting: only a
 * vendor's board hosts count, so a "Powered by Greenhouse" footer link to
 * www.greenhouse.io/careers is not read as a board called `careers`.
 */
export function boardFromLink(href: string): { vendor: BoardVendor; token: string } | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  const path = url.pathname;
  let found: { vendor: BoardVendor; token: string | null } | null = null;

  if (/(^|\.)greenhouse\.io$/.test(host)) {
    if (host === 'boards-api.greenhouse.io' || host === 'api.greenhouse.io') {
      found = { vendor: 'greenhouse', token: path.match(GREENHOUSE_API)?.[1] ?? null };
    } else if (GREENHOUSE_BOARD_HOST.test(host)) {
      found = { vendor: 'greenhouse', token: detectPosting(url.toString()).boardToken };
    } else return null;
  } else if (/(^|\.)lever\.co$/.test(host)) {
    if (host === 'api.lever.co') found = { vendor: 'lever', token: path.match(LEVER_API)?.[1] ?? null };
    else if (LEVER_BOARD_HOST.test(host)) found = { vendor: 'lever', token: detectPosting(url.toString()).boardToken };
    else return null;
  } else if (/(^|\.)ashbyhq\.com$/.test(host)) {
    if (host === 'api.ashbyhq.com') found = { vendor: 'ashby', token: path.match(ASHBY_API)?.[1] ?? null };
    else if (host === 'jobs.ashbyhq.com') found = { vendor: 'ashby', token: detectPosting(url.toString()).boardToken };
    else return null;
  } else {
    const detected = detectPosting(url.toString());
    if (!isBoardVendor(detected.vendor)) return null;
    // The vendors' own marketing sites are not boards.
    if (/^(www\.)?(smartrecruiters|workable|recruitee|breezy|bamboohr|rippling)\.(com|hr)$/.test(host)) return null;
    found = { vendor: detected.vendor, token: detected.boardToken };
  }

  const token = found.token ? decodeURIComponent(found.token) : null;
  if (!token || !TOKEN.test(token) || NOT_TOKENS.has(token.toLowerCase())) return null;
  return { vendor: found.vendor, token };
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&#x2f;|&#47;/gi, '/')
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/');
}

/**
 * Every link on a page, absolute: href, src and action attributes resolved
 * against the page, and full URLs written anywhere else in it (the board
 * links a script-rendered site keeps in its JSON).
 */
export function pageLinks(html: string, pageUrl: string): string[] {
  const out = new Set<string>();
  const body = decodeEntities(html);
  for (const match of body.matchAll(/\b(?:href|src|action|data-src|data-url)\s*=\s*["']([^"']+)["']/gi)) {
    try {
      out.add(new URL(match[1].trim(), pageUrl).toString());
    } catch {
      // Not a URL.
    }
  }
  for (const match of body.matchAll(/https?:\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:\/[^\s"'<>\\)`]*)?/g)) {
    try {
      out.add(new URL(match[0]).toString());
    } catch {
      // Not a URL.
    }
  }
  return [...out];
}

/** The site a host belongs to, without its www. */
export function siteOf(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

const CAREERS_PATH = /\/(careers?|jobs?|join(-us)?|hiring|work-with-us|open-(roles|positions)|positions|opportunities)(\/|$)/i;

/** Links on the company's own site that look like its careers page. */
export function careersLinks(links: readonly string[], site: string): string[] {
  return links.filter((link) => {
    try {
      const url = new URL(link);
      return siteOf(url.hostname) === site && CAREERS_PATH.test(url.pathname);
    } catch {
      return false;
    }
  });
}

/** The boards a page links to, the most linked first. */
export function boardsOnPage(links: readonly string[]): { vendor: BoardVendor; token: string }[] {
  const counts = new Map<string, { vendor: BoardVendor; token: string; n: number; first: number }>();
  links.forEach((link, index) => {
    const board = boardFromLink(link);
    if (!board) return;
    const key = `${board.vendor}:${board.token.toLowerCase()}`;
    const seen = counts.get(key);
    if (seen) seen.n += 1;
    else counts.set(key, { ...board, n: 1, first: index });
  });
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.first - b.first)
    .map(({ vendor, token }) => ({ vendor, token }));
}

export type Page = { url: string; status: number; body: string };

export type BoardIo = {
  /** Reads one page; throws when it cannot be reached. */
  fetchPage: (url: string) => Promise<Page>;
  /** Reads a board; throws when it is not there. */
  readBoard: (vendor: BoardVendor, token: string) => Promise<unknown>;
};

export const LIVE_IO: BoardIo = {
  fetchPage: (url) => safeFetch(url),
  readBoard: (vendor, token) => fetchBoard(vendor, token),
};

function asUrl(raw: string | null | undefined): URL | null {
  if (!raw?.trim()) return null;
  const text = raw.trim();
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

/** Job sites that are not the company's own, so a posting link to one says nothing about its site. */
const NOT_COMPANY_SITES = /(^|\.)(ycombinator\.com|workatastartup\.com|linkedin\.com|wellfound\.com|angel\.co|indeed\.com|glassdoor\.com|google\.com|forms\.gle|notion\.site|notion\.so|github\.com|docs\.google\.com|typeform\.com|airtable\.com)$/i;

/**
 * The board one startup published, or null.
 *
 * In order: the apply link in its own Hacker News post, when that is a board;
 * then its website's home page, then the careers or jobs page on the same
 * site. A startup known only from its post, whose apply link is a careers page
 * rather than a board, has that page read as its site. The first board found
 * that reads is the answer.
 */
export async function findBoard(
  startup: { website: string | null; postingUrl: string | null },
  io: BoardIo,
): Promise<{ board: FoundBoard | null; pages: number }> {
  const tried = new Set<string>();
  const tryBoards = async (boards: { vendor: BoardVendor; token: string }[], from: string) => {
    for (const board of boards) {
      const key = `${board.vendor}:${board.token.toLowerCase()}`;
      if (tried.has(key)) continue;
      tried.add(key);
      try {
        await io.readBoard(board.vendor, board.token);
        return { ...board, from };
      } catch {
        // A link to a board that is gone; try the next.
      }
    }
    return null;
  };

  const posting = asUrl(startup.postingUrl);
  if (posting) {
    const direct = boardFromLink(posting.toString());
    if (direct) {
      const found = await tryBoards([direct], posting.toString());
      if (found) return { board: found, pages: 0 };
    }
  }

  let home = asUrl(startup.website);
  let start = home;
  if (!home && posting && !boardFromLink(posting.toString()) && !NOT_COMPANY_SITES.test(posting.hostname)) {
    home = new URL(posting.origin);
    start = posting;
  }
  if (!home || !start) return { board: null, pages: 0 };

  const queue: string[] = [start.toString()];
  if (start.toString() !== home.toString()) queue.push(home.toString());
  const visited = new Set<string>();
  let pages = 0;
  let site = siteOf(home.hostname);
  let addedDefaults = false;

  while (queue.length > 0 && pages < MAX_PAGES) {
    const next = queue.shift()!;
    const key = next.replace(/\/$/, '').toLowerCase();
    if (visited.has(key)) continue;
    visited.add(key);
    pages += 1;

    let page: Page | null = null;
    try {
      page = await io.fetchPage(next);
    } catch {
      page = null;
    }
    if (page && page.status < 400) {
      const links = pageLinks(page.body, page.url || next);
      const found = await tryBoards(boardsOnPage(links), page.url || next);
      if (found) return { board: found, pages };
      if (pages === 1) {
        // A home page that redirects (to www, or to a new domain) is still the company's own.
        try {
          site = siteOf(new URL(page.url || next).hostname);
        } catch {
          // Keep the site we had.
        }
      }
      for (const link of careersLinks(links, site).slice(0, 2)) queue.push(link);
    }
    if (!addedDefaults) {
      addedDefaults = true;
      queue.push(new URL('/careers', home).toString(), new URL('/jobs', home).toString());
    }
  }
  return { board: null, pages };
}

/** Whether a startup is due a look: no board yet, and not looked for in the last four weeks. */
export function dueForBoardCheck(
  row: { board_token: string | null; board_checked_at: string | null },
  now: Date,
): boolean {
  if (row.board_token) return false;
  if (!row.board_checked_at) return true;
  return now.getTime() - new Date(row.board_checked_at).getTime() >= RECHECK_DAYS * 86_400_000;
}

type WatchlistRow = {
  id: string;
  name: string;
  website: string | null;
  posting_url: string | null;
  board_token: string | null;
  board_checked_at: string | null;
};

export type BoardsOutcome = {
  /** Startups looked at, and of those the ones a board was found for. */
  checked: number;
  found: number;
  /** Startups still due a look when the time ran out. */
  left: number;
};

export type BoardsOptions = {
  now?: Date;
  /** Epoch milliseconds after which no new batch starts. */
  deadline?: number;
  limit?: number;
  /** Overridable for tests. */
  io?: BoardIo;
};

/**
 * One person's watchlist: look for a board for each startup that is due one,
 * and write what was found. Every read and write names the person, so the
 * cron's service client and the person's own behave the same. A found board
 * is written with its vendor, token and the check's time in one update; a
 * miss writes only the time, so the startup waits four weeks.
 */
export async function findStartupBoards(
  supabase: AppSupabaseClient,
  userId: string,
  options: BoardsOptions = {},
): Promise<BoardsOutcome> {
  const now = options.now ?? new Date();
  const io = options.io ?? LIVE_IO;
  const deadline = options.deadline ?? Date.now() + DEFAULT_BUDGET_MS;
  const cutoff = new Date(now.getTime() - RECHECK_DAYS * 86_400_000).toISOString();

  const { data, error } = await supabase
    .from('watchlist_startups')
    .select('id, name, website, posting_url, board_token, board_checked_at')
    .eq('user_id', userId)
    .is('board_token', null)
    .or(`board_checked_at.is.null,board_checked_at.lt.${cutoff}`)
    .order('board_checked_at', { ascending: true, nullsFirst: true })
    .order('last_seen_at', { ascending: false })
    .limit(options.limit ?? BOARDS_PER_RUN);
  if (error) throw new Error(`Reading the watchlist failed: ${error.message}`);
  const due = ((data ?? []) as WatchlistRow[]).filter((row) => dueForBoardCheck(row, now));

  let checked = 0;
  let found = 0;
  for (let i = 0; i < due.length; i += PARALLEL) {
    if (deadline - Date.now() < RESERVE_MS) break;
    const batch = due.slice(i, i + PARALLEL);
    const results = await Promise.all(
      batch.map((row) => findBoard({ website: row.website, postingUrl: row.posting_url }, io)),
    );
    for (const [index, result] of results.entries()) {
      const row = batch[index];
      const patch = result.board
        ? { board_vendor: result.board.vendor, board_token: result.board.token, board_checked_at: now.toISOString() }
        : { board_checked_at: now.toISOString() };
      const update = await supabase
        .from('watchlist_startups')
        .update(patch)
        .eq('id', row.id)
        .eq('user_id', userId);
      if (update.error) throw new Error(`Writing the board for ${row.name} failed: ${update.error.message}`);
      checked += 1;
      if (result.board) found += 1;
    }
  }
  return { checked, found, left: due.length - checked };
}
