import type { ReviewPick } from './choose';

/**
 * What goes to the model for the daily review and how its reply is read
 * (plan #1615). Kept apart from write.ts so it can be tested without the SDK.
 */

export type ReviewReply = {
  overview: string;
  /** One line per pick, in the picks' order. */
  lines: string[];
};

/** The picks as numbered lines, starting at 1, in the order the review shows them. */
export function reviewPrompt(picks: readonly ReviewPick[]): string {
  return picks
    .map((pick, i) => {
      const local = pick.local ? ' (local)' : '';
      const sources = pick.sources > 1 ? ` [in ${pick.sources} newsletters]` : '';
      return `${i + 1}.${local} ${pick.headline}${sources}: ${pick.summary}`;
    })
    .join('\n');
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/**
 * The reply as stored. A blank overview throws, since a review is no review
 * without one. A story the model gave no line for keeps its own summary, so
 * every pick is still listed and opens its story.
 */
export function readReviewReply(input: unknown, picks: readonly ReviewPick[]): ReviewReply {
  const { overview, lines } = (input ?? {}) as { overview?: unknown; lines?: unknown };
  const written = text(overview);
  if (!written) throw new Error('Dash wrote no overview.');

  const byNumber = new Map<number, string>();
  for (const item of Array.isArray(lines) ? lines : []) {
    const { number, line } = (item ?? {}) as { number?: unknown; line?: unknown };
    const said = text(line);
    if (typeof number === 'number' && said && !byNumber.has(number)) byNumber.set(number, said);
  }
  return {
    overview: written,
    lines: picks.map((pick, i) => byNumber.get(i + 1) ?? text(pick.summary)),
  };
}
