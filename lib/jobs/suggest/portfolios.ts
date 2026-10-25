/**
 * The daily read of the portfolio job boards of the investors the person
 * follows (plan #2535.4), beside the read of followed companies' boards in
 * boards.ts.
 *
 * An investor in job_search.followed_investors has a board on Getro or
 * Consider (lib/jobs/ats/portfolio.ts) listing jobs across every company it
 * backs. Each is read once a day on the same ten-minute ticks, back to a day
 * before its last read, and what it showed is kept in
 * job_search.portfolio_postings under the investor, never as a company row:
 * a company goes on file only when the person acts on a suggestion. The same
 * diff as a company's board (board-diff.ts) tells new postings from known
 * ones, and a board's first read records what was up as seen. The new ones
 * join the day's pick in boards.ts, whose found-in line names the investor.
 */
import 'server-only';

import { fetchPortfolioBoard, isPortfolioHost, type PortfolioHost, type PortfolioPosting } from '@/lib/jobs/ats/portfolio';
import { readSince } from '@/lib/jobs/ats/portfolio-parse';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { diffBoard, postingKey, readCutoff } from './board-diff';

/** Investors read a person a tick; a big board is a few dozen requests. */
export const INVESTORS_PER_TICK = 10;
const CHUNK = 50;

type Row = Record<string, unknown>;

type FollowedInvestor = {
  id: string;
  name: string;
  host: PortfolioHost;
  token: string;
  boardUrl: string | null;
  readAt: string | null;
};

export type PortfolioReadOutcome = { tried: number; read: number; added: number };

function chunks<T>(items: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Read the person's followed investors' boards not tried in the last day,
 * the longest waiting first, until `deadline`. Every read and write names
 * the person.
 */
export async function readDuePortfolios(
  supabase: AppSupabaseClient,
  userId: string,
  options: { now?: Date; deadline: number },
): Promise<PortfolioReadOutcome> {
  const now = options.now ?? new Date();
  const outcome: PortfolioReadOutcome = { tried: 0, read: 0, added: 0 };
  const { data, error } = await supabase
    .from('followed_investors')
    .select('id, name, host, token, board_url, read_at')
    .eq('user_id', userId)
    .or(`tried_at.is.null,tried_at.lt.${readCutoff(now)}`)
    .order('tried_at', { ascending: true, nullsFirst: true })
    .limit(INVESTORS_PER_TICK);
  if (error) {
    console.error('[jobs portfolios] followed investors', error.message);
    return outcome;
  }
  const investors: FollowedInvestor[] = [];
  for (const row of (data ?? []) as Row[]) {
    if (!isPortfolioHost(row.host)) continue;
    investors.push({
      id: row.id as string,
      name: row.name as string,
      host: row.host,
      token: row.token as string,
      boardUrl: (row.board_url as string | null) ?? null,
      readAt: (row.read_at as string | null) ?? null,
    });
  }

  for (const investor of investors) {
    if (Date.now() >= options.deadline) break;
    outcome.tried += 1;
    const tried = await supabase
      .from('followed_investors')
      .update({ tried_at: now.toISOString() })
      .eq('user_id', userId)
      .eq('id', investor.id);
    if (tried.error) console.error('[jobs portfolios] tried', tried.error.message);
    try {
      const postings = await fetchPortfolioBoard(investor.host, investor.token, readSince(investor.readAt, now), investor.boardUrl);
      outcome.added += await recordRead(supabase, userId, investor, postings, now);
      outcome.read += 1;
    } catch (err) {
      console.error('[jobs portfolios] read', investor.name, err instanceof Error ? err.message : err);
    }
  }
  return outcome;
}

/** Keep what one board showed since its last read; returns how many postings wait for the pick. */
async function recordRead(
  supabase: AppSupabaseClient,
  userId: string,
  investor: FollowedInvestor,
  postings: readonly PortfolioPosting[],
  now: Date,
): Promise<number> {
  const at = now.toISOString();
  const byKey = new Map(postings.map((posting) => [postingKey(posting.url), posting]));
  // Only the keys this read showed are looked up: the stored rows of a big
  // board run to thousands, and a portfolio read has no "taken down".
  const known: { postingKey: string; goneAt: null }[] = [];
  for (const keys of chunks([...byKey.keys()])) {
    const { data, error } = await supabase
      .from('portfolio_postings')
      .select('posting_key')
      .eq('user_id', userId)
      .eq('investor_id', investor.id)
      .in('posting_key', keys);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Row[]) known.push({ postingKey: row.posting_key as string, goneAt: null });
  }
  const diff = diffBoard(known, postings, investor.readAt === null);

  for (const part of chunks(diff.added)) {
    const { error } = await supabase.from('portfolio_postings').upsert(
      part.map((posting) => {
        const read = byKey.get(posting.postingKey);
        return {
          user_id: userId,
          investor_id: investor.id,
          posting_key: posting.postingKey,
          company_name: (read?.company ?? 'Unknown company').slice(0, 300),
          title: posting.title.slice(0, 500),
          url: posting.url,
          location: posting.location,
          posted_at: read?.postedAt ?? null,
          first_seen_at: at,
          last_seen_at: at,
          offered_at: posting.offered ? at : null,
        };
      }),
      { onConflict: 'investor_id,posting_key', ignoreDuplicates: true },
    );
    if (error) throw new Error(error.message);
  }
  for (const keys of chunks(diff.seen)) {
    const { error } = await supabase
      .from('portfolio_postings')
      .update({ last_seen_at: at })
      .eq('user_id', userId)
      .eq('investor_id', investor.id)
      .in('posting_key', keys);
    if (error) throw new Error(error.message);
  }
  const read = await supabase.from('followed_investors').update({ read_at: at }).eq('user_id', userId).eq('id', investor.id);
  if (read.error) throw new Error(read.error.message);
  return diff.added.filter((posting) => !posting.offered).length;
}
