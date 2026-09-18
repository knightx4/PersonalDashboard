/**
 * Subsequence match, not substring: "jbp" finds "Job search · Pipeline".
 *
 * Ranked so that a match at the start of a word beats one in the middle, which
 * is what makes two letters usually enough.
 *
 * It lives here rather than in the palette because both halves of that list
 * now go through it -- the places you can go, and the things you own -- and
 * two rankers would mean a company sorting differently from the page it lives
 * on for no reason anybody could see.
 *
 * Pure, and no `server-only`: the palette imports it in the browser and the
 * search fan-out imports it on the server.
 */
export function score(haystack: string, needle: string): number | null {
  if (!needle) return 0;
  const target = haystack.toLowerCase();
  const query = needle.toLowerCase();

  let position = 0;
  let points = 0;
  for (const character of query) {
    const found = target.indexOf(character, position);
    if (found === -1) return null;
    const atWordStart = found === 0 || target[found - 1] === ' ' || target[found - 1] === '·';
    points += atWordStart ? 3 : 1;
    if (found === position) points += 1;
    position = found + 1;
  }
  return points;
}
