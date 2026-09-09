/**
 * Where a step came from, when it did not come from you.
 *
 * A re-shape writes rows into a feature you approved last week, and a proposed
 * step appearing under it out of nowhere is confusing in the one way this plan
 * must not be: you cannot tell whether you forgot writing it, or whether
 * something wrote it for you. So every row a re-shape adds is stamped with the
 * answer that produced it, on the first line of its comment, and the page and
 * the brief read that line back out.
 *
 * One line of text rather than a column, because it is a sentence for a person
 * and nothing queries it. A step added by hand or by a shaping session carries
 * no stamp, and reads exactly as it did before.
 */

/** The stamp itself. Written by a re-shape, read by the page and the brief. */
export type ReshapeOrigin = {
  /** The decision whose answer produced this step. */
  number: number;
  /** That answer, short enough for one line. */
  gist: string;
};

/** Long enough to say which answer it was; short enough to sit on a row. */
const MAX_GIST = 160;

/**
 * Compose the line.
 *
 * The gist comes from the decision's own `resolution` rather than from
 * whoever is writing the row, so a session cannot paraphrase an answer into
 * something the person did not say.
 */
export function reshapeStamp(number: number, resolution: string): string {
  const first = resolution.split('\n').find((line) => line.trim()) ?? '';
  const gist = first.trim();
  return `From #${number}'s answer: ${
    gist.length > MAX_GIST ? `${gist.slice(0, MAX_GIST - 1).trimEnd()}…` : gist
  }`;
}

const PATTERN = /^From #(\d+)'s answer: (.+)$/m;

/**
 * Read it back, or null when there is none.
 *
 * Matched anywhere in the comment rather than only at the start: a step
 * stamped by a re-shape can be blocked and closed like any other, and every
 * one of those appends a dated line beneath.
 */
export function reshapeOrigin(comment: string | null): ReshapeOrigin | null {
  if (!comment) return null;
  const match = PATTERN.exec(comment);
  if (!match) return null;
  return { number: Number(match[1]), gist: match[2].trim() };
}
