/**
 * Suggesting roles at discovered startups (plan #1685): read the watchlist
 * startups' boards, pick up to the week's room with roles.ts, store them as
 * suggestions labelled with where the startup was found, and write back to
 * the watchlist which startups showed something that fit.
 *
 * Called by the weekly roles search (lib/jobs/suggest/run.ts) before its web
 * search, so the search does not suggest the same links. No model call: the
 * startups were shortlisted by Dash already (#1682), and the reason it gave
 * is the suggestion's why. A board that fails to load is skipped and its
 * startup is not counted as read.
 */
import 'server-only';

import { fetchBoard, isBoardVendor } from '@/lib/jobs/ats/board';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { admitOpenings, scoredColumns, type Admission, type Admitter } from '@/lib/jobs/suggest/admit';
import { exclusionWords } from '@/lib/jobs/suggest/payload';
import type { OpeningText } from '@/lib/jobs/suggest/scores';
import { JEV_MODEL } from '@/lib/jev/wire';
import { loadDiscoveryRules } from './read';
import {
  EMPTY_WEEKS_LIMIT,
  SOURCE_LABELS,
  boardPosting,
  discoveredText,
  passScored,
  pickDiscovered,
  postRoles,
  readingUpdates,
  scoredPool,
  weekRoom,
  type DiscoveredPosting,
  type WatchedStartup,
} from './roles';

/** At most this many startups read a run, the least recently read first. */
const STARTUPS_PER_RUN = 60;
const PARALLEL = 8;
/** No new batch of boards starts after this long; the web search needs the rest of the request. */
const BUDGET_MS = 20_000;

type Row = Record<string, unknown>;

function startupFrom(row: Row): WatchedStartup {
  const vendor = row.board_vendor as string | null;
  const token = row.board_token as string | null;
  const board = isBoardVendor(vendor) && token ? { vendor, token } : null;
  return {
    id: row.id as string,
    name: row.name as string,
    source: row.source === 'hn' ? 'hn' : 'yc',
    description: (row.description as string | null) ?? null,
    reason: (row.reason as string | null) ?? null,
    boardVendor: board?.vendor ?? null,
    boardToken: board?.token ?? null,
    postingRoles: Array.isArray(row.posting_roles) ? (row.posting_roles as string[]) : [],
    postingLocation: (row.posting_location as string | null) ?? null,
    postingUrl: (row.posting_url as string | null) ?? null,
    emptyWeeks: (row.empty_weeks as number | null) ?? 0,
    lastReadAt: (row.last_read_at as string | null) ?? null,
  };
}

export type DiscoveredOutcome = {
  /** "Title at Company" for each stored. */
  headlines: string[];
  /** The links stored, for the web search to leave alone. */
  urls: string[];
  startupsRead: number;
};

const NOTHING: DiscoveredOutcome = { headlines: [], urls: [], startupsRead: 0 };

/** A discovered role as Jev reads it: its title, company, place and the text it is written with. */
function openingOf(posting: DiscoveredPosting): OpeningText {
  const { why, move } = discoveredText(posting);
  return { title: posting.title, company: posting.company, location: posting.location, why, move };
}

export async function suggestDiscoveredRoles(
  supabase: AppSupabaseClient,
  userId: string,
  context: {
    targetTitles: readonly string[];
    likedTitles: readonly string[];
    taken: { urls: ReadonlySet<string>; roles: ReadonlySet<string>; companies?: ReadonlySet<string> };
    now?: Date;
    /**
     * Given when the person has Jev on: a wider pool is scored, what clears
     * the lowest fit score is written best first up to the week's room, and
     * what falls below it is written as expired so it is not scored again
     * (admit.ts).
     */
    admitter?: Admitter | null;
  },
): Promise<DiscoveredOutcome> {
  // With no titles to match nothing can fit, and counting that as an empty
  // week would age every startup out for the person's missing settings.
  if (context.targetTitles.length === 0 && context.likedTitles.length === 0) return NOTHING;
  const now = context.now ?? new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [watched, thisWeek, rules] = await Promise.all([
    supabase
      .from('watchlist_startups')
      .select(
        'id, name, source, description, reason, board_vendor, board_token, posting_roles, posting_location, posting_url, empty_weeks, last_read_at',
      )
      .eq('user_id', userId)
      .is('company_id', null)
      .lt('empty_weeks', EMPTY_WEEKS_LIMIT)
      .or('board_token.not.is.null,posting_url.not.is.null')
      .order('last_read_at', { ascending: true, nullsFirst: true })
      .limit(STARTUPS_PER_RUN),
    supabase
      .from('suggestions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('origin', 'discovered')
      // A role kept off the list for its fit takes none of the week's room.
      .or('expired_reason.is.null,expired_reason.neq.low_fit')
      .gte('created_at', weekAgo),
    loadDiscoveryRules(supabase, userId),
  ]);
  if (watched.error) {
    console.error('[jobs discovery] watchlist', watched.error.message);
    return NOTHING;
  }
  if (thisWeek.error) {
    console.error('[jobs discovery] this week', thisWeek.error.message);
    return NOTHING;
  }
  const startups = ((watched.data ?? []) as Row[]).map(startupFrom);
  if (startups.length === 0) return NOTHING;

  const postings: DiscoveredPosting[] = [];
  const read: WatchedStartup[] = [];
  for (const startup of startups) {
    const fromPost = postRoles(startup);
    if (fromPost.length > 0 || (!startup.boardToken && startup.postingUrl)) {
      postings.push(...fromPost);
      read.push(startup);
    }
  }
  const withBoard = startups.filter((startup) => startup.boardVendor && startup.boardToken);
  const began = Date.now();
  for (let i = 0; i < withBoard.length && Date.now() - began < BUDGET_MS; i += PARALLEL) {
    const batch = withBoard.slice(i, i + PARALLEL);
    const results = await Promise.allSettled(batch.map((startup) => fetchBoard(startup.boardVendor!, startup.boardToken!)));
    results.forEach((result, index) => {
      if (result.status !== 'fulfilled') return;
      const startup = batch[index];
      read.push(startup);
      for (const posting of result.value) {
        if (!posting.url || !posting.title) continue;
        postings.push(boardPosting(startup, { title: posting.title, url: posting.url, location: posting.location }));
      }
    });
  }

  const room = weekRoom(thisWeek.count ?? 0);
  const admitter = context.admitter ?? null;
  const { picks: pool, fitted } = pickDiscovered(postings, {
    targetTitles: context.targetTitles,
    likedTitles: context.likedTitles,
    taken: {
      urls: context.taken.urls,
      roles: context.taken.roles,
      companies: new Set([...(context.taken.companies ?? []), ...rules.passedCompanies]),
    },
    excludedWords: exclusionWords(rules.excludedIndustries),
    preferences: rules.preferences,
    knownCompanies: rules.knownCompanies,
    room: admitter ? scoredPool(room) : room,
    scored: !!admitter,
  });
  let picks: Admission<DiscoveredPosting>[];
  if (admitter) {
    const scored = await admitOpenings(pool, openingOf, admitter);
    // A candidate Jev could not score in time is left on its board for the
    // next run rather than shown unjudged; one below the gate is written as
    // expired, so it is not scored again.
    const passed = passScored(scored, room, admitter.minFitScore);
    picks = [...passed, ...scored.filter((entry) => entry.belowGate)];
  } else {
    picks = pool.map((item) => ({ item, scores: null, belowGate: false }));
  }

  const headlines: string[] = [];
  const urls: string[] = [];
  for (const admission of picks) {
    const posting = admission.item;
    const { why, move } = discoveredText(posting);
    const { error } = await supabase.from('suggestions').insert({
      user_id: userId,
      kind: 'apply',
      origin: 'discovered',
      found_in: SOURCE_LABELS[posting.startup.source],
      company_name: posting.company,
      headline: posting.title,
      why,
      move,
      url: posting.url,
      location: posting.location,
      watchlist_startup_id: posting.startup.id,
      // Scored already, so the daily scoring run leaves it alone.
      ...scoredColumns(admission, JEV_MODEL),
    });
    if (!error && admission.belowGate) urls.push(posting.url);
    else if (!error) {
      headlines.push(`${posting.title} at ${posting.company}`);
      urls.push(posting.url);
    } else if (error.code !== '23505') console.error('[jobs discovery] suggestion insert', error.message);
  }

  // One write per resulting count, rather than one per startup.
  const byWeeks = new Map<number, string[]>();
  for (const update of readingUpdates(read, fitted, now)) {
    byWeeks.set(update.emptyWeeks, [...(byWeeks.get(update.emptyWeeks) ?? []), update.id]);
  }
  for (const [emptyWeeks, ids] of byWeeks) {
    const { error } = await supabase
      .from('watchlist_startups')
      .update({ empty_weeks: emptyWeeks, last_read_at: now.toISOString() })
      .eq('user_id', userId)
      .in('id', ids);
    if (error) console.error('[jobs discovery] watchlist reading', error.message);
  }

  return { headlines, urls, startupsRead: read.length };
}
