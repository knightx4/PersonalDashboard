/**
 * The open postings on the job boards of the companies the person follows,
 * read before the weekly roles search (job_search 0039).
 *
 * A followed company is one on file with a known board (Greenhouse, Lever,
 * Ashby and the rest in lib/jobs/ats) that the person has not marked passed.
 * Reading a board costs one free request and returns every posting at once,
 * so these are covered completely where five web searches a week cannot be.
 * board-pick.ts narrows them to the ones like what the person wants, and the
 * search chooses among those.
 *
 * A board that fails to load is skipped: it is somebody else's undocumented
 * endpoint, and the web search still runs.
 */
import 'server-only';

import { fetchBoard, isBoardVendor, type BoardVendor } from '@/lib/jobs/ats/board';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { BoardPosting } from './board-pick';

/** At most this many boards a run; each is one request. */
export const BOARD_LIMIT = 80;
/** Boards read at once. */
const PARALLEL = 8;

type CompanyRow = {
  name: string;
  industry: string | null;
  ats_type: string | null;
  ats_board_token: string | null;
};

export async function loadFollowedBoardPostings(supabase: AppSupabaseClient, userId: string): Promise<BoardPosting[]> {
  const { data, error } = await supabase
    .from('companies')
    .select('name, industry, ats_type, ats_board_token')
    .eq('user_id', userId)
    .not('ats_board_token', 'is', null)
    .or('priority.is.null,priority.neq.passed')
    .order('updated_at', { ascending: false })
    .limit(BOARD_LIMIT);
  if (error) {
    console.error('[jobs suggestions] followed boards', error.message);
    return [];
  }
  const companies = ((data ?? []) as CompanyRow[]).filter(
    (row): row is CompanyRow & { ats_type: BoardVendor; ats_board_token: string } =>
      isBoardVendor(row.ats_type) && !!row.ats_board_token,
  );

  const postings: BoardPosting[] = [];
  for (let i = 0; i < companies.length; i += PARALLEL) {
    const batch = companies.slice(i, i + PARALLEL);
    const results = await Promise.allSettled(batch.map((row) => fetchBoard(row.ats_type, row.ats_board_token)));
    results.forEach((result, index) => {
      if (result.status !== 'fulfilled') return;
      const company = batch[index];
      for (const posting of result.value) {
        if (!posting.url || !posting.title) continue;
        postings.push({
          company: company.name,
          industry: company.industry,
          title: posting.title,
          url: posting.url,
          location: posting.location,
        });
      }
    });
  }
  return postings;
}
