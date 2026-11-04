import {
  BRIEF_OPENING,
  type DebateAdvisor,
  type DebateQuestion,
  type DebateTurn,
  type ForecastRange,
} from '@/lib/you/board-debate';
import { advisorHref } from '@/lib/you/board-profile';

/**
 * What a decision's page draws from a worked decision (plan #2581.9): the
 * option the advisors give the best chance, where each advisor stands on it,
 * one line from each, and the headline that says how far they agree.
 *
 * A decision worked since plan #2581.8 carries a probability per option on
 * each turn. One worked before carries only scores out of 10, and its page
 * keeps the older view (debate.tsx), so `isForecast` decides which is drawn.
 */

/** One advisor's latest forecast on a decision, with what the page shows of it. */
export type AdvisorForecast = {
  advisor: DebateAdvisor;
  /** Their latest probability per option that it meets the success measure. */
  probabilities: Record<string, number>;
  /** Their blind round 1 probabilities, for whether they moved. */
  first: Record<string, number> | null;
  ranges: Record<string, ForecastRange> | null;
  budget: Record<string, number> | null;
  changeMind: string | null;
  assessment: string | null;
  /** Their round 1 answer, in full. */
  opening: DebateTurn | null;
  /** One line from it, short enough to quote under their avatar. */
  line: string | null;
};

/** Whether a question was worked with probabilities, or is being, rather than scored out of 10. */
export function isForecast(question: DebateQuestion): boolean {
  return (
    question.door !== null ||
    (question.verdict?.forecasts.length ?? 0) > 0 ||
    question.turns.some((t) => t.probabilities !== null)
  );
}

/**
 * Each advisor's latest forecast, in the board's order: their last turn with
 * probabilities, or the verdict's numbers when no turn carries any.
 */
export function forecastsOf(
  question: DebateQuestion,
  advisors: readonly DebateAdvisor[],
): AdvisorForecast[] {
  return advisors.flatMap((advisor): AdvisorForecast[] => {
    const theirs = question.turns.filter((t) => t.advisorId === advisor.id);
    const withNumbers = theirs.filter((t) => t.probabilities);
    const latest = withNumbers.at(-1) ?? null;
    const fromVerdict = question.verdict?.forecasts.find((f) => f.advisor === advisor.key) ?? null;
    const probabilities = latest?.probabilities ?? fromVerdict?.probabilities ?? null;
    if (!probabilities) return [];
    const opening = theirs.find((t) => t.round === 1) ?? null;
    const withBudget = theirs.filter((t) => t.budget).at(-1) ?? null;
    return [
      {
        advisor,
        probabilities,
        first: opening?.probabilities ?? null,
        ranges: theirs.find((t) => t.ranges)?.ranges ?? null,
        budget: withBudget?.budget ?? fromVerdict?.budget ?? null,
        changeMind: theirs.find((t) => t.changeMind)?.changeMind ?? null,
        assessment: theirs.find((t) => t.assessment)?.assessment ?? null,
        opening,
        line: opening ? quotable(opening.text) : null,
      },
    ];
  });
}

/** The weighted mean per option the verdict gives, or the plain mean while there is no verdict. */
export function meanOf(
  question: DebateQuestion,
  forecasts: readonly AdvisorForecast[],
  letter: string,
): number | null {
  const weighted = question.verdict?.probability?.[letter];
  if (typeof weighted === 'number') return weighted;
  const values = forecasts.flatMap((f) =>
    typeof f.probabilities[letter] === 'number' ? [f.probabilities[letter]] : [],
  );
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** The option the strip is drawn for: the verdict's recommendation, or the highest mean so far. */
export function leadingOption(
  question: DebateQuestion,
  forecasts: readonly AdvisorForecast[],
): string | null {
  if (question.verdict?.recommended) return question.verdict.recommended;
  let best: { letter: string; p: number } | null = null;
  for (const { letter } of question.options) {
    const p = meanOf(question, forecasts, letter);
    if (p !== null && (!best || p > best.p)) best = { letter, p };
  }
  return best?.letter ?? null;
}

export type Agreement = {
  low: number;
  high: number;
  /** high - low, from 0 to 1. */
  gap: number;
  /** Within 15 points they agree; past 35 they are split. */
  kind: 'agree' | 'differ' | 'split';
};

/** How far the advisors' probabilities on one option are apart. */
export function agreementOn(forecasts: readonly AdvisorForecast[], letter: string): Agreement | null {
  const values = forecasts.flatMap((f) =>
    typeof f.probabilities[letter] === 'number' ? [f.probabilities[letter]] : [],
  );
  if (!values.length) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const gap = Math.round((high - low) * 100) / 100;
  return { low, high, gap, kind: gap <= 0.15 ? 'agree' : gap <= 0.35 ? 'differ' : 'split' };
}

/** "62%", for a probability from 0 to 1. */
export function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

/** "10 points", for a gap between two probabilities. */
function points(gap: number): string {
  const n = Math.round(gap * 100);
  return n === 1 ? '1 point' : `${n} points`;
}

/**
 * The one line the decision opens with: which option the advisors give the
 * best chance, how likely they think it, and how far they agree.
 */
export function headline(
  question: DebateQuestion,
  forecasts: readonly AdvisorForecast[],
  running: boolean,
): string {
  const letter = leadingOption(question, forecasts);
  if (!forecasts.length || !letter) {
    return running ? 'No advisor has answered yet.' : 'The advisors gave no forecast on this.';
  }
  const mean = meanOf(question, forecasts, letter) ?? 0;
  const agreement = agreementOn(forecasts, letter);
  const n = forecasts.length;
  if (running) {
    return `${n === 1 ? 'One advisor has' : `${n} advisors have`} answered so far, and ${letter} leads at ${pct(mean)}.`;
  }
  if (n === 1) return `${forecasts[0].advisor.name} gives ${letter} the best chance, ${pct(mean)}.`;
  const opening = `The advisors give ${letter} the best chance, ${pct(mean)}`;
  if (!agreement || agreement.gap === 0) return `${opening}, and all say the same.`;
  if (agreement.kind === 'agree') return `${opening}, and agree within ${points(agreement.gap)}.`;
  return `${opening}, but range from ${pct(agreement.low)} to ${pct(agreement.high)}.`;
}

/**
 * The first sentence of an answer, short enough to quote: links, citations
 * in brackets and emphasis taken out, cut at a word near 160 characters.
 */
export function quotable(text: string): string | null {
  const plain = text
    .replace(BRIEF_OPENING, '')
    .replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, '$1')
    .replace(/\s*\[[0-9a-f]{6,}[^\]]*\]/gi, '')
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return null;
  const sentence = /^(.+?[.!?])(\s|$)/.exec(plain)?.[1] ?? plain;
  if (sentence.length <= 160) return sentence;
  const cut = sentence.slice(0, 157);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 100)).replace(/[,;:\s]+$/, '')}…`;
}

/** The exchange between the two most opposed: round 2 turns addressed to one another. */
export function theExchange(question: DebateQuestion): DebateTurn[] {
  return question.turns.filter(
    (t) => t.round === 2 && t.addressedTo !== null && !BRIEF_OPENING.test(t.text),
  );
}

/** The steelman on a unanimous decision: the brief for the option nobody backed, and the answer to it. */
export function steelmanOf(question: DebateQuestion): { brief: DebateTurn; answer: DebateTurn | null } | null {
  const brief = question.turns.find((t) => BRIEF_OPENING.test(t.text));
  if (!brief) return null;
  const answer =
    question.turns.find(
      (t) => t.position > brief.position && t.addressedTo === brief.advisorId && t.advisorId !== brief.advisorId,
    ) ?? null;
  return { brief, answer };
}

/** What each advisor said once they heard the person's lean, in the order spoken. */
export function leanReplies(question: DebateQuestion): DebateTurn[] {
  return question.turns.filter((t) => t.round === 2 && t.addressedTo === null && !BRIEF_OPENING.test(t.text));
}

/**
 * Rows for the strip, so dots that would overlap stack instead: each value
 * gets the first row where it is at least `gap` from every dot already
 * there, in order of value.
 */
export function stackDots<T extends { p: number }>(dots: readonly T[], gap = 0.09): (T & { row: number })[] {
  const rows: number[][] = [];
  return [...dots]
    .sort((a, b) => a.p - b.p)
    .map((dot) => {
      let row = rows.findIndex((taken) => taken.every((p) => Math.abs(p - dot.p) >= gap));
      if (row === -1) {
        rows.push([]);
        row = rows.length - 1;
      }
      rows[row].push(dot.p);
      return { ...dot, row };
    });
}

/** "80,000 to 95,000 salary", or short as "80K–95K salary"; "0 to 4 people". */
export function rangeText(range: ForecastRange, short = false): string {
  const n = (v: number) =>
    short && Math.abs(v) >= 1000
      ? new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 }).format(v)
      : v.toLocaleString('en-GB', { maximumFractionDigits: 2 });
  const span =
    range.low === range.high ? n(range.low) : `${n(range.low)}${short ? '–' : ' to '}${n(range.high)}`;
  return range.unit ? `${span} ${range.unit}` : span;
}

/** An advisor's profile at their track record, where this decision is listed. */
export function advisorDecisionHref(key: string, questionId: string): string {
  return `${advisorHref(key, 'record')}#decision-${questionId}`;
}
