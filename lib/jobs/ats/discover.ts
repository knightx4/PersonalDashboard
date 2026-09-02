import 'server-only';

import { BOARD_VENDORS, detectPosting, isBoardVendor, type BoardVendor } from './detect';
import { fetchBoard } from './board';
import { titleSimilarity, FUZZY_MIN } from './match';
import type { FetchedPosting } from './types';

/**
 * Finding a company's job board when nobody handed us a link to it.
 *
 * The premise of the whole backfill: most application confirmations do not
 * contain a link to the posting. What they do contain — in the sending
 * subdomain, in a portal link, in the unsubscribe footer — is the board token,
 * and a board token is all any of these APIs actually need.
 *
 * Where even that is missing, the token is guessed from the company name and
 * then *verified*, which is the part that makes guessing acceptable. A guess is
 * only believed when the board it returns contains a posting whose title
 * matches a role we already hold at that company. Without that rule, probing
 * `acme` would cheerfully attach a different Acme's postings to your pipeline
 * and look entirely successful doing it.
 */

export type Trust = 'known' | 'guess';

export interface BoardCandidate {
  vendor: BoardVendor;
  token: string;
  /** `known` came from a URL or a stored value; `guess` has to earn it. */
  trust: Trust;
}

export interface CompanyBoardIdentity {
  name: string;
  /** `companies.ats_type`, which narrows the search to one vendor when set. */
  atsType: string | null;
  /** `companies.ats_board_token` — a token already proven for this company. */
  boardToken: string | null;
  /** `companies.ats_board_hint` — the ATS sending subdomain seen in mail. */
  boardHint: string | null;
  careersUrl: string | null;
  website: string | null;
}

/** Legal and generic tails that are never part of a board token. */
const NAME_TAIL =
  /\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|plc|sa|nv|ab|oy|group|holdings|holding|technologies|technology|labs|software|solutions|systems|digital|studio|studios)\b/g;

/**
 * Board tokens a company name plausibly maps to, most likely first.
 *
 * Every one of these is a guess and is treated as such by the caller. Being
 * generous here is cheap — a wrong token 404s — while being stingy means the
 * whole cascade falls back to a paste box it did not need to.
 */
export function slugCandidates(name: string): string[] {
  const base = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!base) return [];

  const trimmed = base.replace(NAME_TAIL, '').replace(/\s+/g, ' ').trim() || base;
  const words = trimmed.split(' ').filter(Boolean);

  const candidates = [
    trimmed.replace(/\s+/g, ''),
    base.replace(/\s+/g, ''),
    words.join('-'),
    // "Ramp Financial" is `ramp` on Greenhouse far more often than it is
    // `rampfinancial`. Only for a first word long enough not to be an initial.
    words.length > 1 && words[0].length >= 4 ? words[0] : '',
  ];

  return [...new Set(candidates.filter(Boolean))];
}

/**
 * Every (vendor, token) pair worth trying, in the order worth trying them.
 *
 * Pure, so the search order — the thing that decides both the request budget
 * and the false-positive surface — is inspectable in a test rather than
 * emergent from a loop.
 */
export function boardCandidates(
  identity: CompanyBoardIdentity,
  maxCandidates = 12,
): BoardCandidate[] {
  const vendor = isBoardVendor(identity.atsType) ? identity.atsType : null;
  const vendorsFor = (): readonly BoardVendor[] => (vendor ? [vendor] : BOARD_VENDORS);

  const out: BoardCandidate[] = [];
  const seen = new Set<string>();
  const push = (candidate: BoardCandidate) => {
    const key = `${candidate.vendor}:${candidate.token.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(candidate);
  };

  // 1. A token we already proved. When the vendor is recorded too this is the
  //    only call the whole cascade makes.
  if (identity.boardToken) {
    for (const v of vendorsFor()) push({ vendor: v, token: identity.boardToken, trust: 'known' });
  }

  // 2. The careers page, which on most sites is a thin wrapper over the board
  //    and names it in the URL.
  for (const url of [identity.careersUrl, identity.website]) {
    if (!url) continue;
    const detected = detectPosting(url);
    if (isBoardVendor(detected.vendor) && detected.boardToken) {
      push({ vendor: detected.vendor, token: detected.boardToken, trust: 'known' });
    }
  }

  // 3. The ATS sending subdomain from mail — `ramp.greenhouse.io` is `ramp`.
  //    Strong, but still a guess about which board, so it has to be confirmed.
  if (identity.boardHint) {
    for (const v of vendorsFor()) push({ vendor: v, token: identity.boardHint, trust: 'guess' });
  }

  // 4. The company name.
  for (const slug of slugCandidates(identity.name)) {
    for (const v of vendorsFor()) push({ vendor: v, token: slug, trust: 'guess' });
  }

  return out.slice(0, maxCandidates);
}

/**
 * Whether a board we guessed at is actually this company's.
 *
 * One posting matching one role we hold there is enough, and nothing weaker
 * will do: a board that returns jobs proves only that the token belongs to
 * *somebody*.
 */
export function confirmsBoard(
  postings: readonly FetchedPosting[],
  roleTitles: readonly string[],
): boolean {
  return roleTitles.some((title) =>
    postings.some((posting) => titleSimilarity(title, posting.title) >= FUZZY_MIN),
  );
}

export interface DiscoveredBoard {
  vendor: BoardVendor;
  token: string;
  postings: FetchedPosting[];
  /** `known` was handed to us; `confirmed` was guessed and then verified. */
  trust: 'known' | 'confirmed';
}

export type DiscoveryOutcome =
  | { ok: true; board: DiscoveredBoard; probes: number }
  | { ok: false; reason: string; probes: number };

/**
 * Walk the cascade until a board answers and is believed.
 *
 * `roleTitles` are the roles already recorded at this company; they are what
 * confirms a guessed token, so a company whose roles are all still the
 * placeholder title cannot confirm anything and will not try to.
 */
export async function discoverBoard(
  identity: CompanyBoardIdentity,
  roleTitles: readonly string[],
  opts: { maxCandidates?: number } = {},
): Promise<DiscoveryOutcome> {
  const candidates = boardCandidates(identity, opts.maxCandidates);
  if (candidates.length === 0) {
    return { ok: false, reason: 'No board token and nothing to guess one from.', probes: 0 };
  }

  const confirmable = roleTitles.some((title) => title.trim().length > 0);
  let probes = 0;
  let sawBoard = false;

  for (const candidate of candidates) {
    if (candidate.trust === 'guess' && !confirmable) continue;

    probes += 1;
    let postings: FetchedPosting[];
    try {
      postings = await fetchBoard(candidate.vendor, candidate.token);
    } catch {
      // A 404 is the expected answer for most guesses and is not worth
      // recording. Anything else is equally unactionable here.
      continue;
    }

    if (postings.length === 0) continue;
    sawBoard = true;

    if (candidate.trust === 'known') {
      return {
        ok: true,
        board: { ...candidate, postings, trust: 'known' },
        probes,
      };
    }

    if (confirmsBoard(postings, roleTitles)) {
      return {
        ok: true,
        board: { ...candidate, postings, trust: 'confirmed' },
        probes,
      };
    }
  }

  if (!confirmable && candidates.every((candidate) => candidate.trust === 'guess')) {
    return {
      ok: false,
      reason: 'No role title to verify a guessed board against.',
      probes,
    };
  }

  return {
    ok: false,
    reason: sawBoard
      ? 'Found boards, but none carried a posting matching this company’s roles.'
      : 'No public job board found for this company.',
    probes,
  };
}
