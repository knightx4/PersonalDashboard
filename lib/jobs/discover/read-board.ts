import 'server-only';

import { fetchBoard } from '@/lib/jobs/ats/board';
import type { JobBoardResult } from '@/lib/ask/job-board';
import { findBoard, LIVE_IO } from './boards';

/**
 * The open roles on the board a careers page or company site links to, for
 * Dash's read_job_board (note b60cc4a6). The board is found the way the
 * watchlist finds one (findBoard: a link the company published, never a
 * guessed token), through the fetch that refuses private addresses.
 */
export async function readJobBoard(url: string): Promise<JobBoardResult> {
  let found: Awaited<ReturnType<typeof findBoard>>;
  try {
    found = await findBoard({ website: null, postingUrl: url }, LIVE_IO);
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
  if (!found.board) return { ok: false, reason: found.pages > 0 ? 'not_found' : 'unreachable' };
  try {
    const postings = await fetchBoard(found.board.vendor, found.board.token);
    return {
      ok: true,
      vendor: found.board.vendor,
      token: found.board.token,
      postings: postings.map((posting) => ({
        title: posting.title,
        location: posting.location,
        url: posting.url,
      })),
    };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}
