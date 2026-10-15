import { AskInputError, optionalString, type AskContext, type AskToolResult } from './db';

/**
 * read_job_board (note b60cc4a6): Dash reading a company's open roles from its
 * careers page, so "look at their job board and see if any roles look good
 * for me" has an answer. The board is found and read by the Jobs code that
 * already reads boards for the companies on file (lib/jobs/discover/boards.ts
 * and lib/jobs/ats/board.ts): only from a link on the company's own site,
 * through the fetch that refuses private addresses.
 *
 * It reads the board's listing (title, place, link), not every description,
 * and passes no page text on, so what a careers page says cannot become
 * instructions. The read arrives on the context (`ctx.readJobBoard`), bound
 * by lib/talk/ask-request.ts and a stub in tests.
 */

/** One open role on a board. */
export type JobBoardPosting = { title: string; location: string | null; url: string | null };

export type JobBoardResult =
  | { ok: true; vendor: string; token: string; postings: JobBoardPosting[] }
  | { ok: false; reason: 'not_found' | 'unreachable' };

/** How many roles one answer lists; a board longer than this is said to be. */
export const JOB_BOARD_LIMIT = 80;

export async function jobBoardLookup(ctx: AskContext, input: Record<string, unknown>): Promise<AskToolResult> {
  if (!ctx.readJobBoard) return { ok: false, error: 'Job boards cannot be read from here.' };
  const url = optionalString(input, 'url');
  if (!url) throw new AskInputError('Give the company\'s careers page or website as url.');

  const read = await ctx.readJobBoard(url);
  if (!read.ok) {
    return {
      ok: false,
      error:
        read.reason === 'not_found'
          ? 'No job board was found from that page: it links to none of the boards the app reads (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Recruitee, Breezy, BambooHR, Rippling). Ask the person to paste the roles, or a link to one posting.'
          : 'That page could not be read. Check the address, or ask the person to paste the roles.',
    };
  }

  const postings = read.postings.slice(0, JOB_BOARD_LIMIT);
  return {
    ok: true,
    rows: [],
    found: postings,
    totals: { open_roles: read.postings.length, listed: postings.length, board: `${read.vendor}:${read.token}` },
    note:
      read.postings.length > postings.length
        ? `The board has ${read.postings.length} open roles; the first ${postings.length} are listed.`
        : `The board's ${read.postings.length} open roles, listed in full. Each is a title, a place and a link; judge fit from those and the person's job settings, and give the link with any you suggest.`,
    kept: { open_roles: read.postings.length, board: `${read.vendor}:${read.token}` },
  };
}
