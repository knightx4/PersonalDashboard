/**
 * The pure half of Dash's weekly startup shortlist (plan #1682, feature
 * #1679): the filtered hiring lists made into one compact line per company,
 * cut to fit one prompt, and Dash's picks read back into watchlist rows.
 *
 * The same startup can be on both lists, so YC companies and Hacker News
 * posts are merged by companyKey before Dash sees them: a YC company with a
 * post this month is one line carrying both. A Hacker News post's company is
 * only a guess from its first line, so Dash names it, and the picks are
 * merged by name again afterwards.
 *
 * Dash only picks from the lines it was given, by their ids. Anything it
 * returns that is not on them is ignored, and a link is kept only when the
 * post itself gave it, so nothing on the watchlist is made up.
 */
import { companyKey } from '@/lib/jobs/suggest/payload';
import type { CompanyStage } from '@/lib/jobs/suggest/preferences';
import type { HnCandidate, YcCandidate } from './feeds';

/** The shortlist Dash is asked for. */
export const SHORTLIST_MIN = 30;
export const SHORTLIST_MAX = 50;

/**
 * Room for the candidate lines, about 45,000 tokens. The live lists of
 * October 2026 came to about 1,230 YC companies and 225 posts after the
 * filter, roughly 330,000 characters in this format, so most weeks are cut.
 */
export const CANDIDATE_BUDGET_CHARS = 180_000;
/** Of that, the most the posts may take: they are longer per line and fewer. */
export const HN_BUDGET_CHARS = 80_000;

const REASON_MAX = 240;
const FIELD_MAX = 120;
const ROLES_MAX = 8;

/** One startup as Dash is shown it: a YC company, a post, or both. */
export type ShortlistCandidate = {
  /** `Y<n>` for a YC company (with or without a post), `H<n>` for a post alone. */
  id: string;
  /** companyKey of the name; empty for a post whose company could not be guessed. */
  key: string;
  yc: YcCandidate | null;
  hn: HnCandidate | null;
};

/** The two filtered lists merged into one candidate per startup. */
export function buildCandidates(lists: { yc: readonly YcCandidate[]; hn: readonly HnCandidate[] }): ShortlistCandidate[] {
  const out: ShortlistCandidate[] = [];
  const byKey = new Map<string, ShortlistCandidate>();
  for (const yc of lists.yc) {
    const key = companyKey(yc.name);
    if (key && byKey.has(key)) continue;
    const candidate: ShortlistCandidate = { id: `Y${out.length + 1}`, key, yc, hn: null };
    out.push(candidate);
    if (key) byKey.set(key, candidate);
  }
  let posts = 0;
  for (const hn of lists.hn) {
    const key = companyKey(hn.company);
    const same = key ? byKey.get(key) : undefined;
    if (same) {
      // The first post a company made is the one shown; a second is a repeat.
      if (!same.hn) same.hn = hn;
      continue;
    }
    posts += 1;
    const candidate: ShortlistCandidate = { id: `H${posts}`, key, yc: null, hn };
    out.push(candidate);
    if (key) byKey.set(key, candidate);
  }
  return out;
}

function clip(value: string | null | undefined, max: number): string {
  const flat = (value ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trim()}…`;
}

const BOARD_HOSTS = /(?:ashbyhq\.com|greenhouse\.io|lever\.co|workable\.com|recruitee\.com|bamboohr\.com|careers|jobs)/i;

/** A post's links with the careers and board links first, at most three. */
function postLinks(hn: HnCandidate): string[] {
  const links = hn.links.filter((link) => link.length <= 200);
  const boards = links.filter((link) => BOARD_HOSTS.test(link));
  return [...boards, ...links.filter((link) => !boards.includes(link))].slice(0, 3);
}

function postText(hn: HnCandidate): string {
  const body = hn.text.startsWith(hn.header) ? hn.text.slice(hn.header.length) : hn.text;
  const links = postLinks(hn);
  return [
    clip(hn.header, 200),
    clip(body, 300),
    links.length > 0 ? `links: ${links.join(' ')}` : '',
  ]
    .filter(Boolean)
    .join(' :: ');
}

/** One line per candidate, fields separated by ` | `. */
export function candidateLine(candidate: ShortlistCandidate): string {
  const { yc, hn } = candidate;
  if (yc) {
    const facts = [
      yc.stage,
      yc.batch,
      yc.teamSize !== null ? `${yc.teamSize} people` : null,
    ].filter(Boolean);
    const parts = [
      candidate.id,
      clip(yc.name, 60),
      clip(yc.oneLiner ?? yc.description, 140),
      clip(yc.industries.length > 0 ? yc.industries.join(' / ') : yc.industry, 60),
      facts.join(', '),
      clip(yc.locations, 80),
    ];
    if (hn) parts.push(`HN post: ${postText(hn)}`);
    return parts.filter(Boolean).join(' | ');
  }
  return `${candidate.id} | ${hn ? postText(hn) : ''}`;
}

const STOP_WORDS = new Set([
  'about', 'after', 'also', 'and', 'any', 'are', 'but', 'can', 'for', 'from', 'have', 'into', 'just', 'like',
  'more', 'most', 'next', 'not', 'one', 'our', 'out', 'role', 'roles', 'some', 'than', 'that', 'the', 'their',
  'them', 'then', 'there', 'they', 'this', 'want', 'what', 'when', 'where', 'which', 'with', 'work', 'would',
  'year', 'years', 'your', 'job', 'jobs', 'company', 'companies', 'really', 'still', 'been', 'being', 'were',
]);

/** Words in a title that say its level rather than its field, and match too much on their own. */
const TITLE_NOISE = new Set(['staff', 'chief', 'senior', 'lead', 'head', 'manager', 'associate', 'director', 'junior', 'principal', 'officer']);

/**
 * The terms that say what the person is looking for: each target title as a
 * phrase, the field words in it, and the words of the newest thing they
 * wrote about the job they want. Used only to decide which startups to cut
 * when the lists are too long for one prompt.
 */
export function interestTerms(input: { targetTitles: readonly string[]; latestGoal: string | null }): string[] {
  const terms = new Set<string>();
  const words = (text: string) =>
    text
      .toLowerCase()
      .split(/[^a-z0-9&+]+/)
      .map((raw) => raw.replace(/^[&+]+|[&+]+$/g, ''))
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word) && !/^\d+$/.test(word));
  for (const title of input.targetTitles) {
    const phrase = title.toLowerCase().replace(/\s+/g, ' ').trim();
    if (phrase.includes(' ')) terms.add(phrase);
    for (const word of words(title)) if (!TITLE_NOISE.has(word)) terms.add(word);
  }
  if (input.latestGoal) for (const word of words(input.latestGoal.slice(0, 4000))) terms.add(word);
  return [...terms];
}

function searchText(candidate: ShortlistCandidate): string {
  const parts: (string | null)[] = [];
  if (candidate.yc) {
    const yc = candidate.yc;
    parts.push(yc.name, yc.oneLiner, yc.description, yc.industry, ...yc.industries, ...yc.tags);
  }
  if (candidate.hn) parts.push(candidate.hn.text);
  return parts.filter(Boolean).join(' ').toLowerCase();
}

/** How much of what the person wants a candidate's text mentions: a whole title counts three, a word one. */
export function relevance(candidate: ShortlistCandidate, terms: readonly string[]): number {
  if (terms.length === 0) return 0;
  const text = searchText(candidate);
  let score = 0;
  for (const term of terms) {
    const pattern = term.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&');
    if (new RegExp(`(?:^|[^a-z0-9])${pattern}(?:[^a-z0-9]|$)`).test(text)) score += term.includes(' ') ? 3 : 1;
  }
  return score;
}

export type Precut = {
  /** The candidates Dash is shown, posts first, in the order shown. */
  kept: ShortlistCandidate[];
  lines: string[];
  /** How many were left out to fit the prompt. */
  cut: number;
};

/**
 * The candidates that fit one prompt. Posts go first, up to their share,
 * since they name roles and are this month's; YC companies fill the rest.
 * Within each list the ones whose text mentions most of what the person
 * wants go first, then larger teams (a finance or operations hire is more
 * likely at a company past its first few people), then the list's order.
 */
export function precut(
  candidates: readonly ShortlistCandidate[],
  terms: readonly string[],
  budget = CANDIDATE_BUDGET_CHARS,
  hnBudget = HN_BUDGET_CHARS,
): Precut {
  const ranked = candidates.map((candidate, index) => ({
    candidate,
    index,
    score: relevance(candidate, terms),
    team: candidate.yc?.teamSize ?? 0,
    line: candidateLine(candidate),
  }));
  const order = (a: (typeof ranked)[number], b: (typeof ranked)[number]) =>
    b.score - a.score || b.team - a.team || a.index - b.index;
  const posts = ranked.filter((r) => !r.candidate.yc).sort(order);
  const yc = ranked.filter((r) => r.candidate.yc).sort(order);

  const kept: typeof ranked = [];
  let used = 0;
  for (const r of posts) {
    if (used + r.line.length + 1 > Math.min(hnBudget, budget)) continue;
    kept.push(r);
    used += r.line.length + 1;
  }
  for (const r of yc) {
    if (used + r.line.length + 1 > budget) continue;
    kept.push(r);
    used += r.line.length + 1;
  }
  return {
    kept: kept.map((r) => r.candidate),
    lines: kept.map((r) => r.line),
    cut: candidates.length - kept.length,
  };
}

/** One startup Dash shortlisted, read back against the line it was shown. */
export type ShortlistPick = {
  candidate: ShortlistCandidate;
  name: string;
  nameKey: string;
  reason: string;
  /** Dash's fit score from 1 to 100, or null when it gave none that reads. */
  score: number | null;
  /** From a post: the roles it names, where they are, and the link it gives. */
  roles: string[];
  location: string | null;
  link: string | null;
};

type Obj = Record<string, unknown>;

function str(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const flat = value.replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.length <= max ? flat : clip(flat, max);
}

/** Dash's reason, as the person reads it: one plain line. */
function reasonText(value: unknown): string | null {
  const text = str(value, REASON_MAX * 2);
  if (!text) return null;
  return clip(text.replace(/\s*[—–]\s*/g, ', '), REASON_MAX);
}

/** A fit score as Dash gave it: a whole number from 1 to 100, or null. */
export function fitScore(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  return rounded >= 1 && rounded <= 100 ? rounded : null;
}

function sameLink(a: string, b: string): boolean {
  const norm = (url: string) => url.trim().replace(/\/+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

/**
 * Dash's report read against the candidates it was shown. Kept: picks of a
 * shown id with a reason, once each, at most SHORTLIST_MAX, and never a
 * company in `exclude` (companies on file or turned down, by companyKey),
 * which a post's corrected name can turn out to be. A post Dash gives no
 * company for is not a hiring post and is left out.
 */
export function parseShortlist(
  raw: unknown,
  shown: readonly ShortlistCandidate[],
  exclude: ReadonlySet<string> = new Set(),
): ShortlistPick[] {
  const picks = (raw as Obj | null)?.picks;
  if (!Array.isArray(picks)) return [];
  const byId = new Map(shown.map((c) => [c.id, c]));
  const usedIds = new Set<string>();
  const usedKeys = new Set<string>();
  const out: ShortlistPick[] = [];
  for (const item of picks) {
    if (out.length >= SHORTLIST_MAX) break;
    if (!item || typeof item !== 'object') continue;
    const pick = item as Obj;
    const id = typeof pick.id === 'string' ? pick.id.trim().toUpperCase() : '';
    const candidate = byId.get(id);
    if (!candidate || usedIds.has(id)) continue;
    const reason = reasonText(pick.reason);
    if (!reason) continue;
    // "Retool (YC W17)" is Retool: the batch is not part of the name.
    const name = candidate.yc ? candidate.yc.name : str(pick.company, 80)?.replace(/\s*[([].*$/, '') || null;
    const nameKey = companyKey(name);
    if (!name || !nameKey || usedKeys.has(nameKey) || exclude.has(nameKey)) continue;
    usedIds.add(id);
    usedKeys.add(nameKey);

    const hn = candidate.hn;
    const roles = hn && Array.isArray(pick.roles)
      ? pick.roles.map((role) => str(role, FIELD_MAX)).filter((role): role is string => role !== null).slice(0, ROLES_MAX)
      : [];
    const given = hn ? str(pick.link, 500) : null;
    const link = given ? (hn!.links.find((l) => sameLink(l, given)) ?? null) : null;
    out.push({
      candidate,
      name,
      nameKey,
      reason,
      score: fitScore(pick.score),
      roles,
      location: hn ? str(pick.location, FIELD_MAX) : null,
      link,
    });
  }
  return out;
}

/** A watchlist row as the shortlist writes it; the board and reading columns are never sent. */
export type WatchlistWrite = {
  user_id: string;
  name: string;
  name_key: string;
  website: string | null;
  source: 'yc' | 'hn';
  source_ref: string | null;
  description: string | null;
  reason: string;
  fit_score: number | null;
  stage: CompanyStage | null;
  locations: string[];
  posting_roles: string[];
  posting_location: string | null;
  posting_url: string | null;
  last_seen_at: string;
};

/** What is already on the watchlist, as far as the shortlist reads it. */
export type WatchlistExisting = Omit<WatchlistWrite, 'user_id' | 'reason' | 'fit_score' | 'last_seen_at' | 'stage'> & {
  stage: string | null;
};

function ycLocations(yc: YcCandidate): string[] {
  return (yc.locations ?? '')
    .split(';')
    .map((place) => place.trim())
    .filter(Boolean)
    .slice(0, 10);
}

/**
 * The rows to upsert on (user_id, name_key). A startup already on the
 * watchlist is refreshed in place: matched by name, or for a post by its
 * comment id, so a name Dash spells differently next week still lands on
 * the same row. What the new pick does not know is kept from the old row,
 * and the board, the reading history and first_seen_at are never sent, so
 * an upsert leaves them as they were.
 */
export function watchlistRows(
  userId: string,
  picks: readonly ShortlistPick[],
  existing: readonly WatchlistExisting[],
  now: Date,
): WatchlistWrite[] {
  const byKey = new Map(existing.map((row) => [row.name_key, row]));
  const byRef = new Map(
    existing.filter((row) => row.source_ref).map((row) => [`${row.source}:${row.source_ref}`, row]),
  );
  const seen = new Set<string>();
  const out: WatchlistWrite[] = [];
  for (const pick of picks) {
    const { yc, hn } = pick.candidate;
    const source: 'yc' | 'hn' = yc ? 'yc' : 'hn';
    const sourceRef = yc ? (yc.slug ?? (yc.ycId !== null ? String(yc.ycId) : null)) : hn ? String(hn.hnId) : null;
    const old = byKey.get(pick.nameKey) ?? (sourceRef ? byRef.get(`${source}:${sourceRef}`) : undefined);
    const nameKey = old?.name_key ?? pick.nameKey;
    if (seen.has(nameKey)) continue;
    seen.add(nameKey);
    const locations = yc ? ycLocations(yc) : pick.location ? [pick.location] : [];
    out.push({
      user_id: userId,
      name: old?.name ?? pick.name,
      name_key: nameKey,
      website: yc?.website ?? old?.website ?? null,
      source: old?.source ?? source,
      source_ref: old?.source_ref ?? sourceRef,
      description: (yc ? clip(yc.oneLiner ?? yc.description, 500) || null : null) ?? old?.description ?? (hn ? clip(hn.header, 300) : null),
      reason: pick.reason,
      fit_score: pick.score,
      stage: yc?.stage ?? ((old?.stage as CompanyStage | null | undefined) ?? null),
      locations: locations.length > 0 ? locations : (old?.locations ?? []),
      posting_roles: pick.roles.length > 0 ? pick.roles : (old?.posting_roles ?? []),
      posting_location: pick.location ?? old?.posting_location ?? null,
      posting_url: pick.link ?? old?.posting_url ?? null,
      last_seen_at: now.toISOString(),
    });
  }
  return out;
}
