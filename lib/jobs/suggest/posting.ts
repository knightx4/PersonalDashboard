/**
 * Reading each recommended role's posting from its link (job_search 0039).
 *
 * Jev used to score a posting from the headline and Dash's two-sentence
 * summary, so "salary shown", "cover letter" and "red flags" were guesses
 * about text it never saw. This reads the posting itself, stores the text
 * with the pay band and work mode it states, and clears `scored_at` when the
 * text is new so the next scoring run reads it.
 *
 * It also answers whether the posting is still open. Where the link names a
 * job on a board lib/jobs/ats can read, the board is fetched once per company
 * and a job missing from it has closed. Elsewhere a 404 or 410, or a page
 * saying it no longer takes applications, is closed. A closed posting is
 * taken off the list (status expired, expired_reason closed). A page that
 * cannot be read at all stays on the list, marked unreadable, and is scored
 * from the summary as before.
 *
 * Open rows are read again after RECHECK_DAYS, which is how a posting that
 * closes after it was suggested comes off the list.
 */
import 'server-only';

import { detectPosting } from '@/lib/jobs/ats/detect';
import { fetchBoard, hydrate, isBoardVendor, type BoardVendor } from '@/lib/jobs/ats/board';
import { fetchPostingFromUrl } from '@/lib/jobs/ats';
import type { FetchedPosting } from '@/lib/jobs/ats/types';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { extractCompBand, guessWorkMode } from '@/lib/jobs/jd/requirements';
import { postingLooksClosed, POSTING_TEXT_MAX } from './posting-text';

/** How often an open posting is read again. */
export const RECHECK_DAYS = 3;
/** At most this many postings read in one run. */
const CHECK_LIMIT = 40;
/** Postings read at once. */
const PARALLEL = 5;
/**
 * No new batch starts after this long, so the daily run keeps inside its
 * route's five minutes whatever the pages do. What is left is read tomorrow.
 */
const BUDGET_MS = 90_000;

export type PostingCheckOutcome = { read: number; closed: number; unreadable: number };

type Row = { id: string; url: string | null; posting_text: string | null; location: string | null };

type Reading =
  | { state: 'open'; posting: FetchedPosting }
  | { state: 'closed' }
  | { state: 'unreadable' };

/** One posting, with the boards already fetched this run shared between rows. */
async function readPosting(url: string, boards: Map<string, Promise<FetchedPosting[] | null>>): Promise<Reading> {
  const detected = detectPosting(url);
  if (detected.tier === 3) return { state: 'unreadable' };

  if (isBoardVendor(detected.vendor) && detected.boardToken && detected.jobId) {
    const vendor = detected.vendor as BoardVendor;
    const token = detected.boardToken;
    const key = `${vendor}:${token}`;
    if (!boards.has(key)) boards.set(key, fetchBoard(vendor, token).catch(() => null));
    const board = await boards.get(key)!;
    if (board) {
      const listed = board.find((posting) => posting.atsJobId === detected.jobId);
      if (!listed) return { state: 'closed' };
      try {
        return { state: 'open', posting: await hydrate(vendor, token, listed) };
      } catch {
        return listed.text.trim() ? { state: 'open', posting: listed } : { state: 'unreadable' };
      }
    }
    // The board did not load; the posting's own page may still.
  }

  const fetched = await fetchPostingFromUrl(url);
  if (!fetched.ok) return /returned (404|410)\b/.test(fetched.reason) ? { state: 'closed' } : { state: 'unreadable' };
  if (postingLooksClosed(fetched.posting.text)) return { state: 'closed' };
  return fetched.posting.text.trim() ? { state: 'open', posting: fetched.posting } : { state: 'unreadable' };
}

/**
 * Read the open recommended roles not read in RECHECK_DAYS. Every read names
 * the person, so a service client works the same as theirs. Never throws for
 * one posting; a failed write is logged and the rest go on.
 */
export async function checkOpeningPostings(
  supabase: AppSupabaseClient,
  userId: string,
  options: { now?: Date; limit?: number } = {},
): Promise<PostingCheckOutcome> {
  const now = options.now ?? new Date();
  const outcome: PostingCheckOutcome = { read: 0, closed: 0, unreadable: 0 };
  const due = new Date(now.getTime() - RECHECK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('suggestions')
    .select('id, url, posting_text, location')
    .eq('user_id', userId)
    .eq('kind', 'apply')
    .eq('status', 'open')
    .not('url', 'is', null)
    .or(`posting_checked_at.is.null,posting_checked_at.lt.${due}`)
    .order('posting_checked_at', { ascending: true, nullsFirst: true })
    .limit(options.limit ?? CHECK_LIMIT);
  if (error) {
    console.error('[jobs suggestions] posting check', error.message);
    return outcome;
  }

  const boards = new Map<string, Promise<FetchedPosting[] | null>>();
  const rows = (data ?? []) as Row[];
  const began = Date.now();
  for (let i = 0; i < rows.length && Date.now() - began < BUDGET_MS; i += PARALLEL) {
    await Promise.all(rows.slice(i, i + PARALLEL).map((row) => checkOne(supabase, userId, row, boards, now, outcome)));
  }
  return outcome;
}

async function checkOne(
  supabase: AppSupabaseClient,
  userId: string,
  row: Row,
  boards: Map<string, Promise<FetchedPosting[] | null>>,
  now: Date,
  outcome: PostingCheckOutcome,
): Promise<void> {
  let reading: Reading;
  try {
    reading = await readPosting(row.url as string, boards);
  } catch {
    reading = { state: 'unreadable' };
  }
  const checkedAt = now.toISOString();
  let patch: Record<string, unknown>;
  if (reading.state === 'closed') {
    outcome.closed += 1;
    patch = {
      posting_status: 'closed',
      posting_checked_at: checkedAt,
      status: 'expired',
      expired_reason: 'closed',
      acted_at: checkedAt,
    };
  } else if (reading.state === 'unreadable') {
    outcome.unreadable += 1;
    patch = { posting_status: 'unreadable', posting_checked_at: checkedAt };
  } else {
    outcome.read += 1;
    const text = reading.posting.text.trim().slice(0, POSTING_TEXT_MAX);
    const band = extractCompBand(text);
    patch = {
      posting_status: 'open',
      posting_checked_at: checkedAt,
      posting_text: text,
      comp_min_cents: band?.minCents ?? null,
      comp_max_cents: band?.maxCents ?? null,
      work_mode: guessWorkMode(text),
      ...(row.location ? {} : { location: reading.posting.location }),
      // New text means the scores were read without it.
      ...(text !== (row.posting_text ?? '') ? { scored_at: null } : {}),
    };
  }
  const { error: writeError } = await supabase
    .from('suggestions')
    .update(patch)
    .eq('id', row.id)
    .eq('user_id', userId);
  if (writeError) console.error('[jobs suggestions] posting write', writeError.message);
}
