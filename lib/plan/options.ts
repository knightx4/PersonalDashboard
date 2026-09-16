/**
 * The options a decision offers, read back out of the prose that holds them.
 *
 * A decision's options live in its `detail`, because that is where the skill
 * that writes decisions puts them: a paragraph per option, the cost of each,
 * and a recommendation. There is no options column and this deliberately does
 * not add one — the shape of a good question is prose, and a schema that made
 * options first-class would push every question towards a multiple choice it
 * may not be.
 *
 * So this reads rather than requires. When the detail happens to be written as
 * a lettered set — the two forms the plan has actually used, `A — …` and
 * `(a) …` — the page can offer those options as one-click answers. When it is
 * not, nothing is found and the answer box is the whole form, exactly as
 * before. Nothing is ever inferred from an unlabelled paragraph: "A fired
 * session, like the ideas page's button" opens a real option in the plan today
 * and is not a marker, which is why a separator after the letter is required.
 */

export type PlanOption = {
  /** The letter as it was written: the handle the answer is recorded under. */
  letter: string;
  /** The option in a few words: its first sentence, or its first line. */
  label: string;
};

/**
 * `(a) …`, `[a] …`, `A) …`, `A. …`, `A: …`, `A — …`, `A - …`, `A -- …`.
 *
 * The bracketed forms need no separator after them, because the bracket is
 * one. The bare letter does, which is the whole reason a paragraph opening
 * "A fired session…" is prose and not option A.
 *
 * The dash run is one or two characters because `--` is what a keyboard types
 * when an em dash is meant, and it is what the decisions on the plan are
 * actually written with: eighteen of them reached the page as a paragraph
 * rather than as buttons purely because the separator had a second dash in it.
 * Not three or more: `---` on its own line is a rule, and a rule after a
 * letter is likelier a typo than a choice.
 */
const MARKER =
  /^(?:\(([A-Za-z])\)|\[([A-Za-z])\]|([A-Za-z])[).:]|([A-Za-z])\s*(?:[—–]|-{1,2}))\s+(\S.*)$/;

/** Long enough to say which option it is, short enough to sit on a button. */
const LABEL_MAX = 120;

function labelOf(rest: string): string {
  // The first sentence, or the line, whichever ends first. An option's opening
  // sentence is its name -- "PROPOSE ONLY", "Be an OAuth server" -- and what
  // follows it is the cost, which belongs in the detail and not on a button.
  const sentence = rest.match(/^(.+?)\.(?:\s|$)/);
  const label = (sentence ? sentence[1] : rest).trim();
  if (label.length <= LABEL_MAX) return label;

  const cut = label.slice(0, LABEL_MAX);
  const space = cut.lastIndexOf(' ');
  return `${(space > 40 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * The lettered options in a decision's detail, or none.
 *
 * Two at the least, and lettered in order from A, because a single "A." is not
 * a choice and a set that skips from A to C is more likely prose that happened
 * to start with a letter and a full stop than a set of options with one
 * missing.
 */
export function planOptions(detail: string | null): PlanOption[] {
  if (!detail) return [];

  const found: PlanOption[] = [];
  for (const line of detail.split('\n')) {
    const match = MARKER.exec(line.trim());
    if (!match) continue;
    const letter = match[1] ?? match[2] ?? match[3] ?? match[4];
    const rest = match[5];
    if (!letter || !rest) continue;
    found.push({ letter, label: labelOf(rest) });
  }

  if (found.length < 2) return [];

  const sequential = found.every(
    (option, index) => option.letter.toLowerCase() === String.fromCharCode(97 + index),
  );
  return sequential ? found : [];
}

/** What a quick answer records: the letter that was chosen, and what it was. */
export function optionAnswer(option: PlanOption): string {
  return `${option.letter} — ${option.label}`;
}
