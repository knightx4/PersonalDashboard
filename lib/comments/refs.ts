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

/**
 * Steps are numbered from 1; five digits is a plan far larger than this one.
 * A reference may also be written by outline, `#1073.4`, the way the plan page
 * heads the row; a trailing full stop ends a sentence and is not part of it.
 */
const REF = /(^|[^A-Za-z0-9_&#])#(\d{1,5}(?:\.\d+)*)(?![A-Za-z0-9_]|\.\d)/;

/**
 * Where a step reference opens: the step's own page (plan #1931.4), which is
 * its feature's page with the Steps tab open at its row. The page takes a
 * number or an outline, so an outline the reader has no titles for can still
 * be linked without looking it up first. It used to be the whole plan filtered
 * to the number, which is the list rather than the row.
 */
export function planRefHref(ref: number | string): string {
  return `/dev/plan/${encodeURIComponent(String(ref))}`;
}

/** The id a plan row carries, so the link above lands on it. */
export function planRowId(number: number): string {
  return `plan-${number}`;
}

/**
 * `ref` is the step's number. `outline` is set instead, with `ref` null, for
 * an outline the titles did not place when there were no titles to place it
 * with: it still links, by its outline, and the step's page reads it back.
 */
export type RefPart = { text: string; ref: number | null; outline?: string };

/**
 * Which references to read. `all` is every `#494` and `#1073.4`. `outlines`
 * is only the dotted kind, for text where a bare `#3` is far more often a list
 * number or a count than a step (a reply from Dash, note 7cf4109a; a goal's
 * description), and `#1073.4` is never anything else.
 */
export type RefReading = 'all' | 'outlines';

/**
 * A body split into its step references and the words around them.
 *
 * One part per run of text, the same shape `splitOnMention` returns, so the
 * renderer treats the two the same way. A body with no reference in it comes
 * back as a single part.
 *
 * A stored `#1084` is the step's number. A written `#1073.4` is its outline,
 * read back to the number through `titles`; an outline the titles do not
 * place stays as words, since linking `#1073` from it would name the wrong row.
 * Without titles at all, an outline comes back as `outline` and links by
 * itself, since the step's page reads an outline as well as a number.
 */
export function splitOnRefs(
  text: string,
  titles?: PlanRefTitles,
  reading: RefReading = 'all',
): RefPart[] {
  const parts: RefPart[] = [];
  const scan = new RegExp(REF.source, 'g');
  let from = 0;
  let byOutline: Map<string, number> | null = null;
  const numberOf = (written: string): number | null => {
    if (!written.includes('.')) return Number(written);
    if (!byOutline) {
      byOutline = new Map();
      for (const [number, entry] of Object.entries(titles ?? {})) {
        if (entry.outline) byOutline.set(entry.outline, Number(number));
      }
    }
    return byOutline.get(written) ?? null;
  };

  for (let hit = scan.exec(text); hit; hit = scan.exec(text)) {
    const written = hit[2];
    const dotted = written.includes('.');
    if (!dotted && reading === 'outlines') continue;
    const ref = numberOf(written);
    // An outline with no titles to place it is linked by the outline itself.
    // With titles that do not place it, it names no step, and stays words.
    const outline = ref === null && dotted && titles === undefined ? written : null;
    if (ref === null && outline === null) continue;
    // The match carries the character before the `#`, which belongs to the
    // words around it rather than to the reference.
    const before = hit[1] ?? '';
    const start = hit.index + before.length;
    if (start > from) parts.push({ text: text.slice(from, start), ref: null });
    parts.push(
      outline === null
        ? { text: text.slice(start, scan.lastIndex), ref }
        : { text: text.slice(start, scan.lastIndex), ref: null, outline },
    );
    from = scan.lastIndex;
  }

  if (from < text.length || parts.length === 0) {
    parts.push({ text: text.slice(from), ref: null });
  }
  return parts;
}

/**
 * What each step number is called, and where it sits, by number.
 *
 * Built by whichever page has the plan loaded and handed down to the readers,
 * rather than looked up where it is drawn: a raise with nine references in it
 * would otherwise be nine lookups inside a render, and three of the pages that
 * draw comments never load the plan at all.
 *
 * `outline` is the place in the tree the plan page labels the row with --
 * "723.20" for the twentieth step under #723. Absent where the page building
 * this does not have the tree.
 */
export type PlanRefTitles = Readonly<Record<number, { title: string; outline?: string }>>;

/**
 * What a reference reads as: the step's place in the tree where it is known.
 *
 * The plan page labels a step by its outline and says its number nowhere a
 * reader looks, so "#760" in a raise named a step that could not be found by
 * eye: the row reads "#723.20". Note cfd2543f took the number for a mistake.
 * The link still lands on the number, which is the handle; only the words
 * change, to the ones the page uses.
 */
export function planRefText(number: number, titles?: PlanRefTitles): string {
  return `#${titles?.[number]?.outline ?? number}`;
}

/**
 * The hover text on a reference.
 *
 * "#494" told you a step exists and nothing about which one, so following it
 * was the only way to find out -- and following it leaves the page you were
 * reading. The title is what makes the number a sentence you can read without
 * going anywhere.
 *
 * Falls back to the old wording where the page does not know the plan. A
 * reference to a step that has been deleted lands there too, which is correct:
 * saying nothing about it is better than saying something made up.
 */
export function planRefLabel(number: number, titles?: PlanRefTitles): string {
  const title = titles?.[number]?.title;
  return title ? `${planRefText(number, titles)} — ${title}` : `Step #${number} on the plan`;
}

/**
 * The step a linked part names: its number, or its outline where no titles
 * placed it. Null for words. What `planRefHref` and the preview take.
 */
export function refTarget(part: RefPart): number | string | null {
  return part.ref ?? part.outline ?? null;
}
