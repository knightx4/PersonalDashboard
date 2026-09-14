import { createHash } from 'crypto';

/**
 * Requirement extraction from a job description.
 *
 * Computed once per JD and stored on the role, because it is useful three
 * separate ways from one extraction: it tells you before applying whether you
 * are a plausible fit or about to waste an hour, it gives every generated
 * answer its skeleton, and it makes the gaps explicit — which is what you
 * address directly rather than hoping goes unnoticed.
 *
 * Heuristic rather than model-driven on purpose. Job descriptions are already
 * structured as bullet lists under predictable headings, so a parser gets most
 * of the value at zero cost and zero latency, and the evidence layer's match
 * refines what it finds -- see lib/jobs/evidence/match.ts.
 */

export type RequirementKind = 'must_have' | 'nice_to_have' | 'responsibility';

export interface Requirement {
  text: string;
  kind: RequirementKind;
}

const MUST_HEADINGS = [
  /what (we|you)('| a)?re looking for/i,
  /(basic|minimum|required) qualifications/i,
  /\brequirements\b/i,
  /you (should )?(have|bring)/i,
  /qualifications/i,
  /about you/i,
  /who you are/i,
];

const NICE_HEADINGS = [
  /nice to have/i,
  /(preferred|bonus|plus)( qualifications| skills)?/i,
  /(would be a|it'?s a) (plus|bonus)/i,
  /even better if/i,
];

const RESPONSIBILITY_HEADINGS = [
  /what you('| wi)ll (do|be doing|own)/i,
  /responsibilities/i,
  /the role/i,
  /your (impact|day)/i,
  /in this role/i,
];

/** Boilerplate that is never a requirement, however it is formatted. */
const BOILERPLATE = [
  /equal opportunit/i,
  /without regard to/i,
  /reasonable accommodation/i,
  /background check/i,
  /e-?verify/i,
  /^apply\b/i,
  /^(learn|read) more/i,
  /privacy (policy|notice)/i,
  /^\W*$/,
];

const BULLET = /^\s*(?:[•·▪◦*\-–—]|\d+[.)])\s+/;

/**
 * The apostrophe a word processor made, read as the one the patterns are
 * written with.
 *
 * "What You’ll Do:" is the same heading as "What you'll do", and a board that
 * curls its quotes was getting neither its responsibilities nor its
 * requirements read -- the headings simply did not match, so every line under
 * them fell outside any section. Only the comparison is normalised; what is
 * stored is the line as the posting wrote it.
 */
function straighten(line: string): string {
  return line.replace(/[‘’ʼ]/g, "'");
}

function headingKind(line: string): RequirementKind | null {
  const trimmed = straighten(line).trim().replace(/[:：]\s*$/, '');
  if (trimmed.length > 80) return null;
  if (NICE_HEADINGS.some((p) => p.test(trimmed))) return 'nice_to_have';
  if (MUST_HEADINGS.some((p) => p.test(trimmed))) return 'must_have';
  if (RESPONSIBILITY_HEADINGS.some((p) => p.test(trimmed))) return 'responsibility';
  return null;
}

/**
 * A line that starts a section of its own, recognised or not.
 *
 * "What We Offer:", "Compensation", "Base Salary Range" -- none of them is a
 * requirement heading, and all of them mean the list above has finished. That
 * matters once bare lines count (see below): without it, the perks under "What
 * We Offer" would be read as the nice-to-haves of the section before it.
 *
 * Short, unpunctuated, and either ending in a colon or written as a title. A
 * real list item is longer, or has a lower-case word of substance in it --
 * "CPA preferred" and "Experience with SPVs and co-investment vehicles" both
 * stay items.
 */
function opensSection(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 60) return false;
  if (/[:：]\s*$/.test(trimmed)) return true;
  if (/[.;,!?]$/.test(trimmed)) return false;

  const words = trimmed.split(/\s+/);
  if (words.length > 6) return false;
  return words.filter((word) => word.length >= 4).every((word) => /^[A-Z(]/.test(word));
}

/**
 * How many unbulleted lines in a row count as a list.
 *
 * One sentence under "About the role" is prose. Six lines in a row under "What
 * We're Looking For" is a list whose bullet characters did not survive being
 * copied out of the page, which is most of what a pasted description is.
 */
const MIN_BARE_RUN = 3;

function clean(line: string): string {
  return line
    .replace(BULLET, '')
    .replace(/\s+/g, ' ')
    .replace(/[;,.]$/, '')
    .trim();
}

function isUsable(text: string): boolean {
  if (text.length < 12 || text.length > 400) return false;
  return !BOILERPLATE.some((pattern) => pattern.test(text));
}

/**
 * Walk the description, tracking which heading we are under, and take the
 * bullets. A bullet outside any recognised heading is kept as a responsibility
 * only when the JD has no headings at all — otherwise it is navigation or perks.
 *
 * A section whose bullets were lost on the way in is read as well. A posting
 * pasted out of a browser often arrives as one line per item with nothing in
 * front of it, and a parser that only believes in bullet characters reads that
 * as a page of prose and returns nothing at all -- which is what a role with
 * six thousand characters of description and an empty requirement map turned
 * out to be. So a run of short lines under a heading counts as the list it is,
 * and a single sentence under one still does not.
 */
export function extractRequirements(jdText: string): Requirement[] {
  const lines = jdText.replace(/\r\n/g, '\n').split('\n');
  const out: Requirement[] = [];
  const seen = new Set<string>();

  let current: RequirementKind | null = null;
  let sawHeading = false;
  const orphanBullets: string[] = [];

  const take = (text: string, kind: RequirementKind) => {
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ text, kind });
  };

  /** Unbulleted lines standing together in the section being read. */
  let bare: string[] = [];
  /** Whether this section has already given up real bullets. */
  let bulleted = false;

  // Held until the section ends, because whether they are a list is a fact
  // about how many of them there are.
  const flushBare = () => {
    if (current && !bulleted && bare.length >= MIN_BARE_RUN) {
      for (const text of bare) take(text, current);
    }
    bare = [];
  };

  for (const line of lines) {
    const kind = headingKind(line);
    if (kind) {
      flushBare();
      current = kind;
      sawHeading = true;
      bulleted = false;
      continue;
    }

    // A heading this parser does not recognise is still the end of the list
    // above it.
    if (opensSection(line)) {
      flushBare();
      current = null;
      bulleted = false;
      continue;
    }

    if (!BULLET.test(line)) {
      // A blank line does not end a section — plenty of JDs double-space
      // their items.
      if (!line.trim()) continue;

      const text = clean(line);
      // A long paragraph under a heading is prose, not a requirement list, and
      // it breaks the run rather than joining it.
      if (text.length > 200 || !isUsable(text)) flushBare();
      else bare.push(text);
      continue;
    }

    // The first real bullet settles what this section is: the bare lines above
    // it were the sentence introducing the list.
    bare = [];
    bulleted = true;

    const text = clean(line);
    if (!isUsable(text)) continue;

    if (current === null) {
      orphanBullets.push(text);
      continue;
    }

    take(text, current);
  }

  flushBare();

  if (!sawHeading) {
    for (const text of orphanBullets) {
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ text, kind: 'responsibility' });
    }
  }

  return out.slice(0, 60);
}

/** sha1 of the normalized description. Dedupes reposts of the same role. */
export function jdHash(jdText: string): string {
  const normalized = jdText
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
  return createHash('sha1').update(normalized).digest('hex');
}

/** Seniority as advertised. Free text, read off the title and the body. */
export function guessSeniority(title: string, jdText: string): string | null {
  const blob = `${title}\n${jdText.slice(0, 1500)}`.toLowerCase();
  const levels: Array<[RegExp, string]> = [
    [/\b(vp|vice president|head of|director)\b/, 'Director+'],
    [/\bprincipal\b/, 'Principal'],
    [/\bstaff\b/, 'Staff'],
    [/\b(senior|sr\.?)\b/, 'Senior'],
    [/\b(manager|lead)\b/, 'Manager'],
    [/\b(junior|jr\.?|associate|entry.level|graduate|new grad)\b/, 'Junior'],
    [/\bintern(ship)?\b/, 'Intern'],
  ];
  for (const [pattern, label] of levels) {
    if (pattern.test(blob)) return label;
  }
  return null;
}

export function guessWorkMode(jdText: string): 'onsite' | 'hybrid' | 'remote' | null {
  const blob = jdText.slice(0, 4000).toLowerCase();
  if (/\bhybrid\b|\b\d\s*days? (a week |per week )?in (the )?office\b/.test(blob)) return 'hybrid';
  if (/\b(fully )?remote\b|\bwork from anywhere\b|\bremote.first\b/.test(blob)) return 'remote';
  if (/\b(on.?site|in.person|in.office)\b/.test(blob)) return 'onsite';
  return null;
}

/**
 * Comp band from the posting text, in integer cents.
 *
 * Only trusts a range that looks like annual salary: two numbers, both above a
 * plausible floor, in the same currency, near a compensation word. A wrong comp
 * band is worse than a blank one because it silently reorders the pipeline.
 */
export function extractCompBand(
  jdText: string,
): { minCents: number; maxCents: number; currency: string } | null {
  // Every compensation-ish window, not just the first: the first is usually a
  // bare "Compensation" heading with no numbers on the line at all.
  const windows = [
    ...jdText.matchAll(
      /[^.\n]{0,120}(salary|compensation|base pay|pay range|annual)[^.\n]{0,200}/gi,
    ),
  ];

  let money: RegExpMatchArray[] = [];
  for (const window of windows) {
    const found = [
      ...window[0].matchAll(/([$£€])\s?(\d{1,3}(?:,\d{3})+|\d{5,7})(?:\s*[kK])?/g),
    ];
    if (found.length >= 2) {
      money = found;
      break;
    }
  }
  if (money.length < 2) return null;

  const parse = (raw: string, k: boolean): number => {
    const base = Number(raw.replace(/,/g, ''));
    return k ? base * 1000 : base;
  };

  const values = money.slice(0, 2).map((m) => parse(m[2], /[kK]$/.test(m[0])));
  const [min, max] = values.sort((a, b) => a - b);
  if (min < 20_000 || max > 2_000_000 || max <= min) return null;

  const symbol = money[0][1];
  const currency = symbol === '£' ? 'GBP' : symbol === '€' ? 'EUR' : 'USD';
  return { minCents: min * 100, maxCents: max * 100, currency };
}
