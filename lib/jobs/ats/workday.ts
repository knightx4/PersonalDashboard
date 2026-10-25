import 'server-only';

import { FETCH_TIMEOUT_MS, safeFetch } from './ssrf';
import { htmlToText } from './generic';
import type { FetchedPosting } from './types';
import { parseWorkdayToken, workdayToken, type WorkdayBoard } from './workday-token';

/**
 * Workday's career site API (plan #2535.1).
 *
 * The career site at `{tenant}.{wdN}.myworkdayjobs.com/{site}` is a script
 * that calls a public JSON API under `/wday/cxs/{tenant}/{site}`, and that API
 * is what is read here: a POST to `/jobs` lists postings twenty at a time, and
 * a GET of `/job/{path}` returns one posting with its description.
 *
 * As with SmartRecruiters, the listing carries titles and locations but no
 * description, so board postings come back with an empty `text` and
 * lib/jobs/ats/board.ts `hydrate` fetches the description of the ones wanted.
 *
 * Listings are paged, and a large employer's board runs to a hundred pages, so
 * the whole board is read within one read limit (FETCH_TIMEOUT_MS) and what
 * was read by then is kept. Workday reports the total on the first page only,
 * and stops counting at two thousand.
 */

/** Workday answers 400 to any larger page. */
const PAGE_SIZE = 20;
/** Pages read at once after the first. */
const PARALLEL = 4;
/** Workday's own total stops here. */
const MAX_POSTINGS = 2000;

export interface WorkdayListing {
  title?: string;
  externalPath?: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
}

export interface WorkdayPage {
  total?: number;
  jobPostings?: WorkdayListing[];
}

export interface WorkdayDetail {
  jobPostingInfo?: {
    title?: string;
    jobDescription?: string;
    location?: string;
    additionalLocations?: string[];
    remoteType?: string;
    externalUrl?: string;
    jobReqId?: string;
  };
}

function boardOf(token: string): WorkdayBoard {
  const board = parseWorkdayToken(token);
  if (!board) throw new Error('That is not a Workday board token (tenant/wdN/site).');
  return board;
}

function siteUrl(board: WorkdayBoard): string {
  return `https://${board.tenant}.${board.wd}.myworkdayjobs.com/${encodeURIComponent(board.site)}`;
}

function apiUrl(board: WorkdayBoard): string {
  return `https://${board.tenant}.${board.wd}.myworkdayjobs.com/wday/cxs/${encodeURIComponent(board.tenant)}/${encodeURIComponent(board.site)}`;
}

/** One page of the listing, mapped. A listing without a posting path cannot be opened and is left out. */
export function toPostings(page: WorkdayPage, board: WorkdayBoard): FetchedPosting[] {
  const token = workdayToken(board);
  return (page.jobPostings ?? [])
    .filter((listing) => Boolean(listing.title?.trim()) && /^\/job\/.+/.test(listing.externalPath ?? ''))
    .map((listing) => ({
      vendor: 'workday',
      title: listing.title!.trim(),
      text: '',
      url: `${siteUrl(board)}${listing.externalPath}`,
      location: listing.locationsText?.trim() || null,
      atsJobId: listing.externalPath!.replace(/^\/job\//, ''),
      boardToken: token,
      questions: [],
    }));
}

/** One posting's detail, mapped. `jobId` is the path after `/job/`, kept as the id so it matches the listing. */
export function toPosting(detail: WorkdayDetail, board: WorkdayBoard, jobId: string): FetchedPosting {
  const info = detail.jobPostingInfo;
  if (!info?.title) throw new Error('Workday returned no posting.');
  const places = [info.location, ...(info.additionalLocations ?? [])].filter((place): place is string => Boolean(place?.trim()));
  let location = places.length ? places.join('; ') : null;
  if (info.remoteType === 'Remote') location = location ? `Remote — ${location}` : 'Remote';

  return {
    vendor: 'workday',
    title: info.title.trim(),
    text: htmlToText(info.jobDescription ?? ''),
    url: info.externalUrl ?? `${siteUrl(board)}/job/${jobId}`,
    location,
    // The hiring organisation Workday names is a legal entity ("11037
    // Citibank, N.A. United Kingdom"), not the employer's name, so it is left out.
    atsJobId: jobId,
    boardToken: workdayToken(board),
    questions: [],
  };
}

function withDeadline<T>(work: Promise<T>, deadline: number): Promise<T> {
  const left = deadline - Date.now();
  if (left <= 0) return Promise.reject(new Error('Out of time.'));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Out of time.')), left);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Every page of a board that can be read before `budgetMs` runs out. The
 * first page has to answer, or the board is not there and this throws; after
 * that, a page that fails or comes too late ends the read and what was read is
 * returned. `readPage` is the request, injectable for tests.
 */
export async function readPages(
  board: WorkdayBoard,
  readPage: (offset: number) => Promise<WorkdayPage>,
  budgetMs = FETCH_TIMEOUT_MS,
): Promise<FetchedPosting[]> {
  const deadline = Date.now() + budgetMs;
  const first = await withDeadline(readPage(0), deadline);
  const out = toPostings(first, board);
  const total = Math.min(first.total ?? 0, MAX_POSTINGS);

  const offsets: number[] = [];
  for (let offset = PAGE_SIZE; offset < total; offset += PAGE_SIZE) offsets.push(offset);

  for (let i = 0; i < offsets.length; i += PARALLEL) {
    const pages = await Promise.allSettled(
      offsets.slice(i, i + PARALLEL).map((offset) => withDeadline(readPage(offset), deadline)),
    );
    let stop = false;
    for (const page of pages) {
      if (page.status !== 'fulfilled' || !page.value.jobPostings?.length) {
        stop = true;
        continue;
      }
      out.push(...toPostings(page.value, board));
    }
    if (stop) break;
  }

  // A posting added while the pages were read pushes the rest down one, so
  // the last of one page can come back as the first of the next.
  const seen = new Set<string>();
  return out.filter((posting) => {
    const key = posting.atsJobId ?? '';
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function fetchBoard(token: string): Promise<FetchedPosting[]> {
  const board = boardOf(token);
  return readPages(board, async (offset) => {
    const { status, body } = await safeFetch(`${apiUrl(board)}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ appliedFacets: {}, limit: PAGE_SIZE, offset, searchText: '' }),
    });
    if (status !== 200) throw new Error(`Workday returned ${status} for that board.`);
    return JSON.parse(body) as WorkdayPage;
  });
}

export async function fetchPosting(token: string, jobId: string): Promise<FetchedPosting> {
  const board = boardOf(token);
  // Workday's own paths are already URL-safe, so the id is sent as it came,
  // once it is clear it cannot step outside the posting's path.
  if (!/^[^?#\s\\]+$/.test(jobId) || jobId.split('/').some((part) => part === '..' || part === '.' || !part)) {
    throw new Error('That is not a Workday posting id.');
  }
  const { status, body } = await safeFetch(`${apiUrl(board)}/job/${jobId}`, {
    headers: { Accept: 'application/json' },
  });
  if (status !== 200) throw new Error(`Workday returned ${status} for that posting.`);
  return toPosting(JSON.parse(body) as WorkdayDetail, board, jobId);
}
