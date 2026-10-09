import type { BoardVendor } from '@/lib/jobs/ats/board';
import { pickBoardCandidates, type BoardPosting } from '@/lib/jobs/suggest/board-pick';
import { companyKey } from '@/lib/jobs/suggest/payload';
import type { JobPreferences } from '@/lib/jobs/suggest/preferences';
import { postingPlaceFits } from './filter';

/**
 * Which openings at discovered startups go into the weekly suggestions
 * (plan #1685, feature #1679), and what reading their boards does to the
 * watchlist. The reading and writing are roles-run.ts; this is the rule, kept
 * pure so it is tested without fetching.
 *
 * The openings come from the boards found for watchlist startups (#1683) and,
 * for a Hacker News post that gave a direct link but no board, from the roles
 * the post named. They go through the same title rule as the followed
 * companies' boards (board-pick.ts), and the person's exclusions are applied
 * again to each role: excluded industries against the startup's description,
 * companies turned down, companies now on file, and the posting's own
 * location against the workplace and home-location preferences.
 *
 * At most DISCOVERED_PER_WEEK a week, counted from the discovered roles
 * already suggested in the last seven days, and at most PER_STARTUP from one
 * startup, so one big board cannot take the week. These sit on top of the
 * search's own suggestions: origin 'discovered' is not one of the
 * CAPPED_ORIGINS in cadence.ts.
 *
 * A startup whose roles showed nothing that fit for EMPTY_WEEKS_LIMIT weeks in
 * a row leaves the watchlist: its row stays, so the weekly shortlist does not
 * add it again as new, but its board is no longer read.
 */

export const DISCOVERED_PER_WEEK = 10;
export const PER_STARTUP = 2;
export const EMPTY_WEEKS_LIMIT = 4;
/** A read counts as a new week's this long after the last one, with half a day of slack for the cron. */
const WEEK_MS = 6.5 * 24 * 60 * 60 * 1000;

export type DiscoverySource = 'yc' | 'hn';

/** How each discovered role says where it was found, in its found_in line. */
export const SOURCE_LABELS: Record<DiscoverySource, string> = {
  yc: 'Found on YC',
  hn: 'Found on Hacker News',
};

export type WatchedStartup = {
  id: string;
  name: string;
  source: DiscoverySource;
  description: string | null;
  reason: string | null;
  boardVendor: BoardVendor | null;
  boardToken: string | null;
  postingRoles: readonly string[];
  postingLocation: string | null;
  postingUrl: string | null;
  emptyWeeks: number;
  lastReadAt: string | null;
};

export type DiscoveredPosting = BoardPosting & { startup: WatchedStartup };

/** A board posting at a watchlist startup, with the startup's description standing in for its industry. */
export function boardPosting(
  startup: WatchedStartup,
  posting: { title: string; url: string; location: string | null },
): DiscoveredPosting {
  return {
    company: startup.name,
    industry: startup.description,
    title: posting.title,
    url: posting.url,
    location: posting.location,
    startup,
  };
}

/** The roles a Hacker News post named, at its own link, for a startup with no board. */
export function postRoles(startup: WatchedStartup): DiscoveredPosting[] {
  if (startup.boardToken || !startup.postingUrl) return [];
  const url = startup.postingUrl;
  return startup.postingRoles
    .map((title) => title.trim())
    .filter(Boolean)
    .map((title) => boardPosting(startup, { title, url, location: startup.postingLocation }));
}

export type DiscoveredRules = {
  targetTitles: readonly string[];
  likedTitles: readonly string[];
  /** What the roles search must not suggest again (run.ts). */
  taken: { urls: ReadonlySet<string>; roles: ReadonlySet<string>; companies?: ReadonlySet<string> };
  /** `exclusionWords` of the excluded industries. */
  excludedWords: readonly string[];
  preferences: JobPreferences;
  /** companyKey of every company on the companies list. */
  knownCompanies: ReadonlySet<string>;
  /** How many more discovered roles this week may take. */
  room: number;
};

/** Engineering work, by its title: what a finance or operations CV cannot get. */
const ENGINEERING_TITLE =
  /\b(engineer|engineers|engineering|developer|programmer|swe|sre|devops|full[\s-]?stack|front[\s-]?end|back[\s-]?end)\b/i;

export function isEngineeringTitle(title: string): boolean {
  return ENGINEERING_TITLE.test(title);
}

/**
 * The roles to suggest, and the startups that had at least one role that fit
 * (whether or not it was suggested before), which is what keeps a startup on
 * the watchlist.
 */
export function pickDiscovered(
  postings: readonly DiscoveredPosting[],
  rules: DiscoveredRules,
): { picks: DiscoveredPosting[]; fitted: Set<string> } {
  // Nothing after this rule asks Dash, so a title match is the whole test.
  // One saved lead with "Engineer" in it matched every engineering role at
  // every startup, so engineering roles come only to someone whose target
  // titles are engineering.
  const engineering = rules.targetTitles.some(isEngineeringTitle);
  const allowed = postings.filter(
    (posting) =>
      !rules.knownCompanies.has(companyKey(posting.company)) &&
      postingPlaceFits(posting.location, rules.preferences) &&
      (engineering || !isEngineeringTitle(posting.title)),
  );
  const base = {
    targetTitles: rules.targetTitles,
    likedTitles: rules.likedTitles,
    excludedWords: rules.excludedWords,
    limit: Number.POSITIVE_INFINITY,
  };
  const fitting = pickBoardCandidates(allowed, {
    ...base,
    taken: { urls: new Set(), roles: new Set(), companies: rules.taken.companies },
  });
  const fitted = new Set(fitting.map((posting) => posting.startup.id));
  if (rules.room <= 0) return { picks: [], fitted };

  // Ranked as board-pick ranks them (on a target title first), then spread:
  // each startup's best role before any startup's second.
  const fresh = pickBoardCandidates(allowed, { ...base, taken: rules.taken });
  const urls = new Set<string>();
  const perStartup = new Map<string, number>();
  const picks: DiscoveredPosting[] = [];
  for (let pass = 1; pass <= PER_STARTUP && picks.length < rules.room; pass += 1) {
    for (const posting of fresh) {
      if (picks.length >= rules.room) break;
      if (urls.has(posting.url)) continue;
      const count = perStartup.get(posting.startup.id) ?? 0;
      if (count >= pass) continue;
      urls.add(posting.url);
      perStartup.set(posting.startup.id, count + 1);
      picks.push(posting);
    }
  }
  return { picks, fitted };
}

/** How many discovered roles this week may still take, from those suggested in the last seven days. */
export function weekRoom(suggestedThisWeek: number): number {
  return Math.max(0, DISCOVERED_PER_WEEK - suggestedThisWeek);
}

/**
 * What reading the startups writes back: a startup with a role that fit
 * starts its count again; one without, read a week or more after its last
 * counted read, adds a week. A second read inside the same week changes
 * nothing, so pressing Search now twice does not age a startup out.
 */
export function readingUpdates(
  read: readonly WatchedStartup[],
  fitted: ReadonlySet<string>,
  now: Date,
): { id: string; emptyWeeks: number }[] {
  const out: { id: string; emptyWeeks: number }[] = [];
  for (const startup of read) {
    if (fitted.has(startup.id)) {
      out.push({ id: startup.id, emptyWeeks: 0 });
      continue;
    }
    const due = !startup.lastReadAt || now.getTime() - new Date(startup.lastReadAt).getTime() >= WEEK_MS;
    if (due) out.push({ id: startup.id, emptyWeeks: startup.emptyWeeks + 1 });
  }
  return out;
}

/** The suggestion's why and move, written to the person. */
export function discoveredText(posting: DiscoveredPosting): { why: string; move: string } {
  const { startup } = posting;
  const where =
    startup.source === 'yc'
      ? `${startup.name} is on YC's list of companies that are hiring.`
      : `${startup.name} posted in this month's Hacker News "Who is hiring?" thread.`;
  const why = startup.reason?.trim() ? startup.reason.trim() : where;
  const move = [
    '1. Read the posting at the link.',
    `2. Save it here if it fits, which adds ${startup.name} to your companies.`,
    '3. Apply on their own site.',
  ].join('\n');
  return { why, move };
}
