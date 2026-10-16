/**
 * What a session moved (plan #2164.6): the end-of-run card on Practice Flow
 * and after today's piece. Built from the answers stored in the last hour
 * and nothing else, so it is the same wherever it is opened.
 *
 * It names the ideas the answers showed, with a line from what was written,
 * the ones missed with what was missing, and the ideas that came onto the
 * fringe because of what was shown. Pure, so it is tested without a database;
 * the reads are `summary-store.ts`.
 */

/** Answers looked back over. A run is whatever was answered inside this. */
export const SUMMARY_WINDOW_MS = 60 * 60 * 1000;

/** A run of this many answers or more always ends with the card. */
export const SUMMARY_MIN_ANSWERS = 5;

/** Longest quote shown, in characters. The rest is cut at a word. */
export const QUOTE_CHARS = 140;

/** Most rows under each heading. */
export const SUMMARY_ROWS = 5;

/** One stored answer, whichever table it came from. */
export type SummaryAnswer = {
  /** The idea, or the piece when the answer was to a piece's check. */
  name: string;
  /** What the person wrote or picked. Null for "I don't know". */
  quote: string | null;
  /** Whether it held. */
  held: boolean;
  /** The marker's one line on what was missing or wrong, when it wrote one. */
  why: string | null;
  /** Ideas answered about more than once in the hour keep their last answer. */
  conceptId: string | null;
  answeredAt: string;
};

export type RunSummary = {
  answers: number;
  shown: { name: string; quote: string | null }[];
  missed: { name: string; quote: string | null; why: string | null }[];
  /** Ideas that became ready to learn because of what was shown. */
  fringe: string[];
  /** Rows left out of each list by the row limit, for "and 2 more". */
  more: { shown: number; missed: number; fringe: number };
};

/** A quote cut to length at a word, with an ellipsis when it was cut. */
export function quoteOf(text: string | null | undefined): string | null {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (flat === '') return null;
  if (flat.length <= QUOTE_CHARS) return flat;
  const cut = flat.slice(0, QUOTE_CHARS);
  const space = cut.lastIndexOf(' ');
  return `${(space > QUOTE_CHARS / 2 ? cut.slice(0, space) : cut).replace(/[,;:.\s]+$/, '')}…`;
}

/**
 * The summary of the answers, newest last. An idea answered twice counts
 * once, by its last answer: explaining it and then answering the follow-up
 * is one idea moving, and the later answer is where it ended. A question
 * answered with a pick (no words of its own) has the picked option as its
 * quote.
 */
export function buildSummary(answers: readonly SummaryAnswer[], fringeNames: readonly string[]): RunSummary {
  const ordered = [...answers].sort((a, b) => a.answeredAt.localeCompare(b.answeredAt));
  const last = new Map<string, SummaryAnswer>();
  ordered.forEach((answer, index) => last.set(answer.conceptId ?? `row-${index}`, answer));
  const settled = [...last.values()];

  const shown = settled.filter((answer) => answer.held);
  const missed = settled.filter((answer) => !answer.held);
  const fringe = [...new Set(fringeNames)];

  return {
    answers: answers.length,
    shown: shown.slice(0, SUMMARY_ROWS).map((a) => ({ name: a.name, quote: quoteOf(a.quote) })),
    missed: missed
      .slice(0, SUMMARY_ROWS)
      .map((a) => ({ name: a.name, quote: quoteOf(a.quote), why: quoteOf(a.why) })),
    fringe: fringe.slice(0, SUMMARY_ROWS),
    more: {
      shown: Math.max(0, shown.length - SUMMARY_ROWS),
      missed: Math.max(0, missed.length - SUMMARY_ROWS),
      fringe: Math.max(0, fringe.length - SUMMARY_ROWS),
    },
  };
}

/** The opening line: how many answers, on how many ideas, and how they went. */
export function summaryHeadline(summary: RunSummary): string {
  const held = summary.shown.length + summary.more.shown;
  const missed = summary.missed.length + summary.more.missed;
  const ideas = held + missed;
  const answers = `${summary.answers} ${summary.answers === 1 ? 'answer' : 'answers'}`;
  const on = ideas === summary.answers ? '' : ` on ${ideas} ${ideas === 1 ? 'idea' : 'ideas'}`;
  if (missed === 0) return `${answers}${on}, and every idea shown`;
  if (held === 0) return `${answers}${on}, none shown yet`;
  return `${answers}${on}: ${held} shown, ${missed} missed`;
}
