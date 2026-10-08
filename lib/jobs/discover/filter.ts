import { companyKey, exclusionWords, isExcluded } from '@/lib/jobs/suggest/payload';
import type { JobPreferences } from '@/lib/jobs/suggest/preferences';
import type { HiringCandidate, HnCandidate, YcCandidate } from './feeds';

/**
 * Which discovered startups go forward to the shortlist (plan #1681). No AI:
 * a startup is left out when the person's saved preferences rule it out
 * (lib/jobs/suggest/preferences.ts and the excluded industries), when it is
 * already on their companies list, or when they turned one of its roles down
 * for being that company.
 *
 * The rules lean towards keeping. This runs before Dash reads anything, so a
 * startup kept wrongly costs one line of the shortlist prompt, and one
 * dropped wrongly is never seen. Where a feed does not say (an HN post names
 * no stage; a YC entry has no location), the rule does not apply.
 *
 * Stage: YC says Early, Growth or Public, and a stage outside the ones asked
 * for drops the company. HN posts carry no stage.
 *
 * Workplace: with remote as the only way they will work, a company that does
 * not hire remotely at all is dropped (YC's "Remote" region; "remote" in an
 * HN header). Hybrid or on-site wanted alone drops nothing, since a remote
 * company still has an office.
 *
 * Home location: when set, a company stays if it is somewhere the location
 * names (any comma-separated part, with common short forms written out), or
 * if it is fully remote and remote work is acceptable. "Partly Remote" on YC
 * does not count: those companies hire near an office.
 *
 * Industry: the excluded industries' words, matched as whole words against
 * YC's industry, sub-industry, tags, one-liner and name, or an HN post's
 * header. The long description and an HN post's body are not matched; they
 * mention customers and past work too often.
 *
 * Pure, so each rule is tested against saved copies of the feeds.
 */

export type DiscoveryRules = {
  preferences: JobPreferences;
  /** As stored on the profile, such as ["Crypto", "Healthcare"]. */
  excludedIndustries: readonly string[];
  /** companyKey of every company on the companies list, passed or not. */
  knownCompanies: ReadonlySet<string>;
  /** Website hosts of companies on the list, without `www.`. */
  knownDomains: ReadonlySet<string>;
  /** companyKey of every company whose role they turned down as "Not this company". */
  passedCompanies: ReadonlySet<string>;
};

export type DropReason = 'on_file' | 'passed' | 'industry' | 'stage' | 'workplace' | 'location';

export type DroppedCandidate = { candidate: HiringCandidate; reason: DropReason };

export type FilteredHiringLists = {
  yc: YcCandidate[];
  hn: HnCandidate[];
  dropped: DroppedCandidate[];
};

/** Short forms a home location is often written in, and what the feeds say instead. */
const PLACE_FORMS: Record<string, readonly string[]> = {
  uk: ['united kingdom'],
  'u.k.': ['united kingdom'],
  england: ['united kingdom'],
  'great britain': ['united kingdom'],
  us: ['united states', 'usa'],
  'u.s.': ['united states', 'usa'],
  usa: ['united states', 'usa'],
  'united states': ['usa'],
  america: ['united states', 'usa'],
  nyc: ['new york'],
  'new york city': ['new york'],
  sf: ['san francisco'],
  'bay area': ['san francisco', 'oakland', 'berkeley', 'palo alto', 'san jose', 'mountain view', 'san mateo'],
  'sf bay area': ['san francisco', 'oakland', 'berkeley', 'palo alto', 'san jose', 'mountain view', 'san mateo'],
  la: ['los angeles'],
  dc: ['washington'],
  uae: ['united arab emirates', 'dubai'],
};

/** The words a home location is matched by: each comma-separated part and its other forms. */
export function homePlaceWords(homeLocation: string | null): string[] {
  if (!homeLocation) return [];
  const words = new Set<string>();
  for (const raw of homeLocation.split(/[,;/]|\bor\b/i)) {
    const part = raw.trim().toLowerCase().replace(/\s+/g, ' ');
    if (part.length < 2) continue;
    words.add(part);
    for (const form of PLACE_FORMS[part] ?? []) words.add(form);
  }
  return [...words];
}

function mentions(words: readonly string[], haystack: string): boolean {
  const lower = haystack.toLowerCase();
  return words.some((word) =>
    new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(lower),
  );
}

type Remote = 'full' | 'partly' | 'none' | 'unknown';

function ycRemote(c: YcCandidate): Remote {
  const regions = c.regions.map((r) => r.toLowerCase());
  if (regions.includes('fully remote')) return 'full';
  if (regions.includes('remote') || regions.includes('partly remote')) return 'partly';
  const known = regions.filter((r) => r !== 'unspecified');
  return known.length === 0 && !c.locations ? 'unknown' : 'none';
}

/** What a line of text says about remote work: "part remote" is partly, "no remote" none. */
function textRemote(text: string): Remote {
  const lower = text.toLowerCase();
  if (/\b(no|not)\s+remote\b/.test(lower)) return 'none';
  if (/\b(part|partly|partial|partially)[\s-]+remote\b/.test(lower)) return 'partly';
  return /\bremote\b/.test(lower) ? 'full' : 'none';
}

function hnRemote(c: HnCandidate): Remote {
  return textRemote(c.header);
}

function placeReason(remote: Remote, place: string, prefs: JobPreferences, homeWords: readonly string[]): DropReason | null {
  if (remote === 'unknown') return null;
  const remoteOk = prefs.workplaces.length === 0 || prefs.workplaces.includes('remote');
  const remoteOnly = prefs.workplaces.length === 1 && prefs.workplaces[0] === 'remote';
  if (remoteOnly && remote === 'none') return 'workplace';
  if (homeWords.length > 0 && !(remoteOk && remote === 'full') && !mentions(homeWords, place)) return 'location';
  return null;
}

function ycReason(c: YcCandidate, rules: DiscoveryRules, words: readonly string[], homeWords: readonly string[]): DropReason | null {
  const key = companyKey(c.name);
  if (rules.knownCompanies.has(key) || (c.domain !== null && rules.knownDomains.has(c.domain))) return 'on_file';
  if (rules.passedCompanies.has(key)) return 'passed';
  if (isExcluded(words, c.industry, c.industries.join(' '), c.tags.join(' '), c.oneLiner, c.name)) return 'industry';
  const stages = rules.preferences.companyStages;
  if (stages.length > 0 && c.stage !== null && !stages.includes(c.stage)) return 'stage';
  const place = [c.locations ?? '', ...c.regions].join('; ');
  return placeReason(ycRemote(c), place, rules.preferences, homeWords);
}

function hnReason(c: HnCandidate, rules: DiscoveryRules, words: readonly string[], homeWords: readonly string[]): DropReason | null {
  const key = c.company ? companyKey(c.company) : '';
  const domains = c.links.map((link) => {
    try {
      return new URL(link).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      return '';
    }
  });
  if ((key && rules.knownCompanies.has(key)) || domains.some((d) => d && rules.knownDomains.has(d))) return 'on_file';
  if (key && rules.passedCompanies.has(key)) return 'passed';
  if (isExcluded(words, c.header)) return 'industry';
  return placeReason(hnRemote(c), c.header, rules.preferences, homeWords);
}

/**
 * Whether a single posting's location suits the preferences, by the same
 * workplace and home-location rules the lists were filtered by. A posting
 * that names no location is kept.
 */
export function postingPlaceFits(location: string | null, prefs: JobPreferences): boolean {
  if (!location || !location.trim()) return true;
  return placeReason(textRemote(location), location, prefs, homePlaceWords(prefs.homeLocation)) === null;
}

/** The YC companies and HN posts that pass the rules above, and why each of the rest did not. */
export function filterHiringLists(
  lists: { yc: readonly YcCandidate[]; hn: readonly HnCandidate[] },
  rules: DiscoveryRules,
): FilteredHiringLists {
  const words = exclusionWords(rules.excludedIndustries);
  const homeWords = homePlaceWords(rules.preferences.homeLocation);
  const out: FilteredHiringLists = { yc: [], hn: [], dropped: [] };
  for (const c of lists.yc) {
    const reason = ycReason(c, rules, words, homeWords);
    if (reason) out.dropped.push({ candidate: c, reason });
    else out.yc.push(c);
  }
  for (const c of lists.hn) {
    const reason = hnReason(c, rules, words, homeWords);
    if (reason) out.dropped.push({ candidate: c, reason });
    else out.hn.push(c);
  }
  return out;
}
