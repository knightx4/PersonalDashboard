/**
 * The daily read of the job boards of the companies the person follows, and
 * the daily pick of what is new on them (plan #2535.3).
 *
 * A followed company is one on file with a known board (Greenhouse, Lever,
 * Ashby and the rest in lib/jobs/ats) that the person has not marked passed.
 * Every one is read once a day, a few at a time on the ten-minute batch cron
 * (inngest/jobs/suggestions.ts runSearchBatches), so no request runs past its
 * five minutes. What each read showed is kept in job_search.board_postings,
 * and board-diff.ts compares it with the read before:
 *
 * - a posting not seen before waits for the day's pick;
 * - a posting the board no longer shows is marked gone, and an open
 *   suggestion of it is expired as closed;
 * - a board's first read records everything as seen and suggests none of it.
 *
 * The pick runs at most once a day and only when there are new postings that
 * pass pickBoardCandidates (board-pick.ts). One model call, no web search,
 * chooses among them (model.ts pickNewBoardOpenings), and each role it keeps
 * says in its found-in line when it appeared.
 *
 * A board that fails to load is skipped until the next day: it is somebody
 * else's undocumented endpoint. companies.board_tried_at spaces the tries and
 * board_read_at says when one last loaded, which the health check compares.
 */
import 'server-only';

import { fetchBoard, isBoardVendor, type BoardVendor } from '@/lib/jobs/ats/board';
import type { SpendSink } from '@/lib/core/spend/pricing';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { Admitter } from './admit';
import { diffBoard, newOnBoardLine, pickDue, readCutoff, type ReadPosting, type StoredPosting } from './board-diff';
import { pickBoardCandidates, type BoardPosting } from './board-pick';
import { openingFeedback } from './feedback';
import { pickNewBoardOpenings } from './model';
import { exclusionWords } from './payload';
import { loadSeeker } from './run';
import { openingsTaken, storeOpenings, type BoardOrigin } from './store';

/** At most this many boards a person a tick; each is one request. */
export const BOARDS_PER_TICK = 40;
/** Boards read at once. */
const PARALLEL = 8;
/** Keys or ids named in one `in` filter, so the request line stays short. */
const CHUNK = 50;

type Row = Record<string, unknown>;

type FollowedBoard = {
  id: string;
  name: string;
  vendor: BoardVendor;
  token: string;
  readAt: string | null;
};

function chunks<T>(items: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export type BoardReadOutcome = {
  tried: number;
  read: number;
  /** New postings kept for the pick. */
  added: number;
  /** Postings taken down since the last read. */
  gone: number;
  /** Open suggestions expired because their posting was taken down. */
  expired: number;
};

/**
 * Read the person's followed boards not tried in the last day, the longest
 * waiting first, until `deadline`. Every read and write names the person, so
 * the service client's missing RLS changes nothing.
 */
export async function readDueBoards(
  supabase: AppSupabaseClient,
  userId: string,
  options: { now?: Date; deadline: number },
): Promise<BoardReadOutcome> {
  const now = options.now ?? new Date();
  const outcome: BoardReadOutcome = { tried: 0, read: 0, added: 0, gone: 0, expired: 0 };
  const { data, error } = await supabase
    .from('companies')
    .select('id, name, ats_type, ats_board_token, board_read_at')
    .eq('user_id', userId)
    .not('ats_board_token', 'is', null)
    .or('priority.is.null,priority.neq.passed')
    .or(`board_tried_at.is.null,board_tried_at.lt.${readCutoff(now)}`)
    .order('board_tried_at', { ascending: true, nullsFirst: true })
    .limit(BOARDS_PER_TICK);
  if (error) {
    console.error('[jobs boards] followed boards', error.message);
    return outcome;
  }
  const boards: FollowedBoard[] = [];
  for (const row of (data ?? []) as Row[]) {
    const vendor = row.ats_type as string | null;
    const token = row.ats_board_token as string | null;
    if (!isBoardVendor(vendor) || !token) continue;
    boards.push({ id: row.id as string, name: row.name as string, vendor, token, readAt: (row.board_read_at as string | null) ?? null });
  }

  for (let i = 0; i < boards.length && Date.now() < options.deadline; i += PARALLEL) {
    const batch = boards.slice(i, i + PARALLEL);
    const results = await Promise.allSettled(batch.map((board) => fetchBoard(board.vendor, board.token)));
    outcome.tried += batch.length;
    const tried = await supabase
      .from('companies')
      .update({ board_tried_at: now.toISOString() })
      .eq('user_id', userId)
      .in(
        'id',
        batch.map((board) => board.id),
      );
    if (tried.error) console.error('[jobs boards] tried', tried.error.message);
    for (const [index, result] of results.entries()) {
      if (result.status !== 'fulfilled') continue;
      const board = batch[index];
      try {
        const recorded = await recordRead(
          supabase,
          userId,
          board,
          result.value.flatMap((posting) =>
            posting.url ? [{ title: posting.title, url: posting.url, location: posting.location }] : [],
          ),
          now,
        );
        outcome.read += 1;
        outcome.added += recorded.added;
        outcome.gone += recorded.gone;
        outcome.expired += recorded.expired;
      } catch (err) {
        console.error('[jobs boards] record', board.name, err instanceof Error ? err.message : err);
      }
    }
  }
  return outcome;
}

/** Keep what one board showed, mark what it no longer shows, and expire suggestions of what was taken down. */
async function recordRead(
  supabase: AppSupabaseClient,
  userId: string,
  board: FollowedBoard,
  postings: readonly ReadPosting[],
  now: Date,
): Promise<{ added: number; gone: number; expired: number }> {
  const at = now.toISOString();
  const stored = await supabase
    .from('board_postings')
    .select('posting_key, url, gone_at')
    .eq('user_id', userId)
    .eq('company_id', board.id)
    .limit(5000);
  if (stored.error) throw new Error(stored.error.message);
  const rows = (stored.data ?? []) as { posting_key: string; url: string; gone_at: string | null }[];
  const known: StoredPosting[] = rows.map((row) => ({ postingKey: row.posting_key, goneAt: row.gone_at }));
  const diff = diffBoard(known, postings, board.readAt === null);

  if (diff.added.length > 0) {
    const { error } = await supabase.from('board_postings').upsert(
      diff.added.map((posting) => ({
        user_id: userId,
        company_id: board.id,
        posting_key: posting.postingKey,
        title: posting.title.slice(0, 500),
        url: posting.url,
        location: posting.location,
        first_seen_at: at,
        last_seen_at: at,
        offered_at: posting.offered ? at : null,
      })),
      { onConflict: 'company_id,posting_key', ignoreDuplicates: true },
    );
    if (error) throw new Error(error.message);
  }
  for (const keys of chunks(diff.seen)) {
    const { error } = await supabase
      .from('board_postings')
      .update({ last_seen_at: at, gone_at: null })
      .eq('user_id', userId)
      .eq('company_id', board.id)
      .in('posting_key', keys);
    if (error) throw new Error(error.message);
  }
  let expired = 0;
  if (diff.gone.length > 0) {
    const goneKeys = new Set(diff.gone);
    const goneUrls = rows.filter((row) => goneKeys.has(row.posting_key)).map((row) => row.url);
    for (const keys of chunks(diff.gone)) {
      const { error } = await supabase
        .from('board_postings')
        .update({ gone_at: at })
        .eq('user_id', userId)
        .eq('company_id', board.id)
        .in('posting_key', keys);
      if (error) throw new Error(error.message);
    }
    for (const urls of chunks(goneUrls)) {
      const { data, error } = await supabase
        .from('suggestions')
        .update({ status: 'expired', expired_reason: 'closed', acted_at: at })
        .eq('user_id', userId)
        .eq('kind', 'apply')
        .eq('status', 'open')
        .in('url', urls)
        .select('id');
      if (error) console.error('[jobs boards] expire', error.message);
      else expired += (data ?? []).length;
    }
  }
  const read = await supabase.from('companies').update({ board_read_at: at }).eq('user_id', userId).eq('id', board.id);
  if (read.error) throw new Error(read.error.message);
  return { added: diff.added.filter((posting) => !posting.offered).length, gone: diff.gone.length, expired };
}

export type BoardPickOutcome = {
  /** False when nothing was asked: not due, or nothing new passed the title rule. */
  ran: boolean;
  /** "Title at Company" for each written onto the list. */
  headlines: string[];
  error: string | null;
};

const NOT_RUN: BoardPickOutcome = { ran: false, headlines: [], error: null };

type NewPosting = BoardPosting & { id: string; firstSeenAt: string };

async function markOffered(supabase: AppSupabaseClient, userId: string, ids: readonly string[], at: string): Promise<void> {
  for (const part of chunks(ids)) {
    const { error } = await supabase.from('board_postings').update({ offered_at: at }).eq('user_id', userId).in('id', part);
    if (error) console.error('[jobs boards] offered', error.message);
  }
}

/**
 * The day's pick of new postings. Every new posting is marked offered, so it
 * is judged once; the ones that pass the title rule go to Dash, and only when
 * the call succeeds are they marked, so a failed pick is tried again the next
 * day with the same postings.
 */
export async function pickNewBoardPostings(
  supabase: AppSupabaseClient,
  userId: string,
  options: { apiKey: string; now?: Date; deadline?: number; admitter?: Admitter | null; onSpend?: SpendSink },
): Promise<BoardPickOutcome> {
  const now = options.now ?? new Date();
  const at = now.toISOString();
  const profile = await supabase.from('profiles').select('boards_picked_at, timezone').eq('id', userId).maybeSingle();
  if (profile.error) throw new Error(`Reading when the boards were last picked failed: ${profile.error.message}`);
  const p = (profile.data ?? {}) as Row;
  if (!pickDue((p.boards_picked_at as string | null) ?? null, now)) return NOT_RUN;

  const fresh = await supabase
    .from('board_postings')
    .select('id, title, url, location, first_seen_at, companies ( name, industry )')
    .eq('user_id', userId)
    .is('offered_at', null)
    .is('gone_at', null)
    .order('first_seen_at', { ascending: true })
    .limit(500);
  if (fresh.error) throw new Error(`Reading the new board postings failed: ${fresh.error.message}`);
  const postings: NewPosting[] = ((fresh.data ?? []) as Row[]).map((row) => {
    const company = one(row.companies as Row | Row[] | null);
    return {
      id: row.id as string,
      company: (company?.name as string | undefined) ?? 'Unknown company',
      industry: (company?.industry as string | null | undefined) ?? null,
      title: row.title as string,
      url: row.url as string,
      location: (row.location as string | null) ?? null,
      firstSeenAt: row.first_seen_at as string,
    };
  });
  if (postings.length === 0) return NOT_RUN;

  const [seeker, taken, past, responded] = await Promise.all([
    loadSeeker(supabase, userId),
    openingsTaken(supabase, userId),
    supabase
      .from('suggestions')
      .select('status, headline, company_name, dismiss_reason, dismiss_text')
      .eq('user_id', userId)
      .eq('kind', 'apply')
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('applications')
      .select('roles ( title )')
      .eq('user_id', userId)
      .not('first_human_response_at', 'is', null)
      .limit(500),
  ]);
  if (past.error) throw new Error(`Reading the earlier suggestions failed: ${past.error.message}`);
  const pastRows = (past.data ?? []) as Row[];
  const feedback = openingFeedback(
    pastRows.map((row) => ({
      status: row.status as string,
      headline: (row.headline as string | null) ?? null,
      companyName: (row.company_name as string | null) ?? null,
      dismissReason: (row.dismiss_reason as string | null) ?? null,
      dismissText: (row.dismiss_text as string | null) ?? null,
    })),
  );
  const likedTitles = [
    ...pastRows.filter((row) => row.status === 'done' && row.headline).map((row) => row.headline as string),
    ...((responded.data ?? []) as Row[])
      .map((row) => one(row.roles as Row | Row[] | null)?.title as string | undefined)
      .filter((title): title is string => !!title),
  ];
  const companies = new Set([...taken.companies, ...feedback.companies]);
  const candidates =
    seeker.goals.length === 0 && seeker.targetTitles.length === 0
      ? []
      : pickBoardCandidates(postings, {
          targetTitles: seeker.targetTitles,
          likedTitles,
          taken: { urls: taken.urls, roles: taken.roles, companies },
          excludedWords: exclusionWords(seeker.excludedIndustries),
        });
  const chosen = new Set(candidates.map((posting) => posting.id));
  await markOffered(
    supabase,
    userId,
    postings.filter((posting) => !chosen.has(posting.id)).map((posting) => posting.id),
    at,
  );
  if (candidates.length === 0) return NOT_RUN;

  const result = await pickNewBoardOpenings(
    { apiKey: options.apiKey, deadline: options.deadline, onSpend: options.onSpend },
    { seeker, feedback, candidates, taken: { urls: taken.urls, roles: taken.roles, companies } },
  );
  const picked = await supabase.from('profiles').update({ boards_picked_at: at }).eq('id', userId);
  if (picked.error) console.error('[jobs boards] picked at', picked.error.message);
  if (!result.ok) return { ran: true, headlines: [], error: result.error };
  await markOffered(supabase, userId, [...chosen], at);

  const timeZone = (p.timezone as string | null) ?? 'UTC';
  const origins: BoardOrigin[] = candidates.map((posting) => ({
    url: posting.url,
    company: posting.company,
    foundIn: newOnBoardLine(posting.company, posting.firstSeenAt, timeZone),
  }));
  const headlines = await storeOpenings(supabase, userId, result.suggestions, origins, options.admitter ?? null);
  return { ran: true, headlines, error: null };
}
