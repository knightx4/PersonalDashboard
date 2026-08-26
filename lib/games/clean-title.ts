/**
 * Retail product names are not game names.
 *
 * A UPC lookup returns "Stonemaier Games Wingspan Board Game, Ages 14+, 1-5
 * Players, 40-70 Min"; a shelf photo returns whatever fits on a box edge.
 * BGG wants "Wingspan". This strips the packaging noise both directions.
 */

const NOISE_SEGMENTS =
  /\b(ages?\s*\d+\+?|\d+\s*[-–]\s*\d+\s*players?|\d+\+?\s*players?|\d+\s*[-–]?\s*\d*\s*min(?:ute)?s?|board ?game|card ?game|family game|strategy game|party game|the game of|game for (?:the )?\w+|brand new|sealed|new in shrink|nib)\b/gi;

const TRAILING_JUNK = /[\s,\-–—:;|/&+]+$/;
const LEADING_JUNK = /^[\s,\-–—:;|/&+]+/;

/** Publisher names that lead retail titles and are never part of the game name. */
const LEADING_PUBLISHERS =
  // Longest form first — "hasbro" would otherwise win and strand "Gaming".
  /^(hasbro gaming|hasbro|mattel games|mattel|ravensburger|asmodee|z[- ]?man games|days of wonder|stonemaier games|fantasy flight games?|rio grande games|catan studio|leder games|repos production|renegade game studios|winning moves|the op|usaopoly|pegasus spiele|thames ?& ?kosmos|kosmos|libellud|space cowboys|plan b games|cmon|iello|blue orange)\b[\s,:-]*/i;

export function cleanGameTitle(raw: string): string {
  let title = raw.trim().replace(/\s+/g, ' ');

  // Retail listings bolt the publisher on the front; BGG search does worse
  // with it than without.
  title = title.replace(LEADING_PUBLISHERS, '');

  // Everything after a comma or pipe is almost always marketing copy.
  title = title.split(/\s*[|]\s*/)[0] ?? title;
  const commaSplit = title.split(/\s*,\s*/);
  if (commaSplit.length > 1 && NOISE_SEGMENTS.test(commaSplit.slice(1).join(', '))) {
    NOISE_SEGMENTS.lastIndex = 0;
    title = commaSplit[0] ?? title;
  }
  NOISE_SEGMENTS.lastIndex = 0;

  title = title.replace(NOISE_SEGMENTS, ' ');
  NOISE_SEGMENTS.lastIndex = 0;

  // Drop now-empty brackets left behind by the noise strip.
  title = title.replace(/\(\s*\)|\[\s*\]/g, ' ');
  title = title.replace(/\s{2,}/g, ' ');
  title = title.replace(LEADING_JUNK, '').replace(TRAILING_JUNK, '');

  return title.trim();
}

/**
 * Expansions read as "Catan: Seafarers" on BGG but "Catan Expansion Seafarers"
 * on a box. Normalizing both to a comparable form keeps scoring honest.
 */
export function normalizeForCompare(raw: string): string {
  return cleanGameTitle(raw)
    .toLowerCase()
    .replace(/\bexpansion\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
