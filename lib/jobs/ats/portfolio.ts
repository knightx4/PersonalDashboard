import 'server-only';

import { safeFetch } from './ssrf';
import {
  considerPostings,
  considerSession,
  getroDone,
  getroPostings,
  postedSince,
  type PortfolioHost,
  type PortfolioPosting,
} from './portfolio-parse';

/**
 * Investors' portfolio job boards (plan #2535.4): the postings that went up
 * since a date, across every company the board lists. The shapes, and what
 * each service needs to answer, are in portfolio-parse.ts.
 *
 * A big fund's board holds tens of thousands of postings, so a read never
 * takes the whole board: Getro is read newest first until a page goes past
 * `since`, Consider is asked for the last week and filtered to `since`. Both
 * stop at a page cap, which only a board posting more than a thousand roles a
 * day would reach.
 */

export { isPortfolioHost, PORTFOLIO_HOSTS, type PortfolioHost, type PortfolioPosting } from './portfolio-parse';

const GETRO_MAX_PAGES = 50;
const CONSIDER_PAGE_SIZE = 100;
const CONSIDER_MAX_PAGES = 10;

/**
 * Every posting on one portfolio board that went up at or after `since`.
 * `token` is Getro's collection id or the Consider board's hostname. Throws
 * with what the service answered when it will not serve the read.
 */
export async function fetchPortfolioBoard(
  host: PortfolioHost,
  token: string,
  since: Date,
  boardUrl: string | null = null,
): Promise<PortfolioPosting[]> {
  return host === 'getro' ? readGetro(token, since, boardUrl) : readConsider(token, since);
}

async function readGetro(collection: string, since: Date, boardUrl: string | null): Promise<PortfolioPosting[]> {
  if (!/^\d+$/.test(collection)) throw new Error(`"${collection}" is not a Getro collection id.`);
  const out: PortfolioPosting[] = [];
  for (let page = 0; page < GETRO_MAX_PAGES; page += 1) {
    const { status, body } = await safeFetch(`https://api.getro.com/api/v2/collections/${collection}/search/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ hitsPerPage: 20, page, filters: '', query: '' }),
    });
    if (status !== 200) throw new Error(`Getro returned ${status}: ${body.slice(0, 200)}`);
    const { postings } = getroPostings(JSON.parse(body), boardUrl);
    out.push(...postedSince(postings, since));
    if (getroDone(postings, since) || postings.length < 20) break;
  }
  return out;
}

async function readConsider(hostname: string, since: Date): Promise<PortfolioPosting[]> {
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(hostname)) throw new Error(`"${hostname}" is not a board's hostname.`);
  const page = await safeFetch(`https://${hostname}/jobs`, { headers: { Accept: 'text/html' } });
  if (page.status !== 200) throw new Error(`Consider's board page returned ${page.status}.`);
  const session = considerSession(page.body);
  if (!session) throw new Error('The board page names no Consider board or CSRF token.');
  const cookie = page.cookies.join('; ');
  const out: PortfolioPosting[] = [];
  let sequence: string | null = null;
  for (let n = 0; n < CONSIDER_MAX_PAGES; n += 1) {
    const meta: Record<string, unknown> = { size: CONSIDER_PAGE_SIZE };
    if (sequence) meta.sequence = sequence;
    const { status, body } = await safeFetch(`https://${hostname}/api-boards/search-jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Cookie: cookie, 'X-CSRF-Token': session.csrf },
      body: JSON.stringify({ meta, board: session.board, query: { postedSince: 'P7D' }, grouped: false }),
    });
    if (status !== 200) throw new Error(`Consider returned ${status}: ${body.slice(0, 200)}`);
    const parsed = considerPostings(JSON.parse(body));
    out.push(...postedSince(parsed.postings, since));
    sequence = parsed.sequence;
    if (!sequence || parsed.postings.length < CONSIDER_PAGE_SIZE) break;
  }
  return out;
}
