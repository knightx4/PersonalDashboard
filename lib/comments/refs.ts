/**
 * `#494` in a comment, turned back into the thing it names.
 *
 * Sessions write plan numbers constantly -- "its only open steps are #499, and
 * #500, #501 and #505 all wait on it" -- because a number is how one step
 * refers to another in the queue it was read from. To the person reading that
 * sentence later it is four numbers and no information: finding out what #499
 * is means opening the plan, choosing a view wide enough to contain it, and
 * searching. Four times, for one paragraph.
 *
 * So the numbers become links. Nothing about how anything is written changes;
 * this is a reading of what is already there.
 *
 * The boundaries are the same idea as the `@dash` tag's next door, for the same
 * reason -- a rule that fires where it should not is worse than no rule:
 *
 *  - `&#39;` and the rest of the HTML entities, by refusing a preceding `&`;
 *  - `##494`, by refusing a preceding `#`;
 *  - `#494a`, a word that starts with digits, by refusing a trailing letter;
 *  - anything over five digits, which is not a step number and is more likely
 *    an id or a hash.
 *
 * A three-digit CSS colour is the one collision left and it is accepted: in a
 * dev thread `#494` is a step about a thousand times for every time it is a
 * shade of green, and a colour is nearly always written inside code, which the
 * caller never offers here.
 */

/** Steps are numbered from 1; five digits is a plan far larger than this one. */
const REF = /(^|[^A-Za-z0-9_&#])#(\d{1,5})(?![A-Za-z0-9_])/;

/** Where a step number is read. `all`, because a link must reach a closed one. */
export function planRefHref(number: number): string {
  return `/dev/plan?view=all#plan-${number}`;
}

/** The id a plan row carries, so the link above lands on it. */
export function planRowId(number: number): string {
  return `plan-${number}`;
}

export type RefPart = { text: string; ref: number | null };

/**
 * A body split into its step references and the words around them.
 *
 * One part per run of text, the same shape `splitOnMention` returns, so the
 * renderer treats the two the same way. A body with no reference in it comes
 * back as a single part.
 */
export function splitOnRefs(text: string): RefPart[] {
  const parts: RefPart[] = [];
  const scan = new RegExp(REF.source, 'g');
  let from = 0;

  for (let hit = scan.exec(text); hit; hit = scan.exec(text)) {
    // The match carries the character before the `#`, which belongs to the
    // words around it rather than to the reference.
    const before = hit[1] ?? '';
    const start = hit.index + before.length;
    if (start > from) parts.push({ text: text.slice(from, start), ref: null });
    parts.push({ text: text.slice(start, scan.lastIndex), ref: Number(hit[2]) });
    from = scan.lastIndex;
  }

  if (from < text.length || parts.length === 0) {
    parts.push({ text: text.slice(from), ref: null });
  }
  return parts;
}
