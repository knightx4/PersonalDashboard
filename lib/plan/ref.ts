/**
 * How a plan step is named to the person, and how a name is read back.
 *
 * A step has two numbers. `number` (#1084) is its identity in the database.
 * `outline` (1073.4) is where it sits, the fourth step under feature #1073,
 * and it is what the row on the page heads itself with. Naming a step by one
 * in one place and the other somewhere else left the person translating
 * between them, so from 12 October 2026 everything names a step by its
 * outline, in what is shown and in what is written down. Text from before
 * then still says `#1084`, and `readableRefs` shows it with the outline.
 *
 * The outline of a top-level feature is its number, so a feature reads the
 * same either way.
 */

/** Enough of a step to name it. */
export type Nameable = { number: number; outline?: string | null };

/** `#1073.4`: a step as the person reads it. Falls back to the number when no tree placed it. */
export function stepRef(step: Nameable): string {
  return `#${step.outline || step.number}`;
}

/** Number → outline, for the rows a tree placed. */
export type OutlineIndex = ReadonlyMap<number, string>;

/** Every placed row's outline by its number, walking a tree's nodes and their children. */
export function outlineIndex(
  nodes: Iterable<{ number: number; outline: string; children?: readonly unknown[] }>,
): Map<number, string> {
  const index = new Map<number, string>();
  const walk = (list: Iterable<{ number: number; outline: string; children?: readonly unknown[] }>) => {
    for (const node of list) {
      index.set(node.number, node.outline);
      if (node.children) walk(node.children as typeof node[]);
    }
  };
  walk(nodes);
  return index;
}

/** `#1073.4` for a bare number, or `#1084` when the index has not placed it. */
export function refFor(number: number, outlines: OutlineIndex): string {
  return stepRef({ number, outline: outlines.get(number) });
}

// A `#1084` that is a whole reference: not part of `#10845` or `#1084.2`, and
// not a pull request or issue, which number their own way.
const STORED = /(?<!\b(?:PR|pr|pull request|issue|Issue)\s?)#(\d+)(?!\.?\d|\w)/g;

/**
 * Stored text as the person should read it: every `#1084` that is a step
 * becomes `#1073.4`. Numbers the index does not know are left alone, since
 * they are not steps.
 */
export function readableRefs(text: string, outlines: OutlineIndex): string {
  return text.replace(STORED, (whole, digits: string) => {
    const outline = outlines.get(Number(digits));
    return outline ? `#${outline}` : whole;
  });
}

/**
 * The step a typed name means: `1073.4`, `#1073.4`, `1084` or `#1084`. An
 * outline is looked up; a bare number is the step's own number. Null when an
 * outline names no step or the text is neither.
 */
export function numberFromRef(raw: string, outlines: OutlineIndex): number | null {
  const text = raw.trim().replace(/^#/, '');
  if (/^\d+$/.test(text)) return Number(text);
  if (!/^\d+(?:\.\d+)+$/.test(text)) return null;
  for (const [number, outline] of outlines) if (outline === text) return number;
  return null;
}
