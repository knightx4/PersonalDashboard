/**
 * Whether a rewritten answer on an information step counts as a change
 * (plan #1035).
 *
 * #992 settled that a closed information step reopens only when the rewritten
 * answer differs from the old one. What "differs" means depends on what the
 * answer states:
 *
 * - a date differs when it moves at all (#998);
 * - an amount differs when it moves by more than 5% (#1033);
 * - a written answer differs when its meaning changes, which the goals
 *   routine judges with a one-line reason (#1034; plan #1036 stores it).
 *
 * The change is measured from the answer as it stood when its step last
 * closed (#1047), so small monthly rises add up. Before a step has closed,
 * it is measured from the answer as stored.
 *
 * Plan #997 calls `answerChange` before reopening a step, instead of
 * comparing the wording.
 */

import type { AnswerValue, StepAnswer } from '@/lib/goals/answers';

/** An amount has to move by more than this percentage to count (#1033). */
export const AMOUNT_MARGIN_PERCENT = 5;

/** The routine's judgement on a rewritten written answer (#1034). */
export type MeaningVerdict = { changed: boolean; reason: string };

/** The answer as the routine has just worked it out. */
export type RewrittenAnswer = {
  answer: string;
  value: AnswerValue;
  /** For a written answer: whether its meaning changed, and why. */
  meaning?: MeaningVerdict;
};

export type AnswerChange = {
  changed: boolean;
  /** The answer the change was measured from: the closing one, or the stored one. */
  from: string;
  /** One line saying what moved, or that nothing did. */
  reason: string;
};

const DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

function formatDate(day: string): string {
  return DATE.format(new Date(`${day}T00:00:00Z`));
}

function formatAmount(amount: number): string {
  const whole = Number.isInteger(amount);
  return amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

const cents = (n: number) => Math.round(Math.abs(n) * 100);

/** Wording as compared when the routine gave no verdict: case and spacing aside. */
const words = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Whether `after` changes `before`, measured from `before.closed` when the
 * step has closed since the answer was written.
 *
 * A written answer, or one whose kind changed, is judged by `after.meaning`.
 * Without a verdict it falls back to the wording, ignoring case and spacing,
 * so an answer the routine did not judge is shown rather than hidden.
 */
export function answerChange(
  before: Pick<StepAnswer, 'answer' | 'value' | 'closed'>,
  after: RewrittenAnswer,
): AnswerChange {
  const base = before.closed ?? { answer: before.answer, value: before.value };
  const was = base.value;
  const now = after.value;

  if (was.kind === 'date' && now.kind === 'date') {
    const changed = was.date !== now.date;
    return {
      changed,
      from: base.answer,
      reason: changed
        ? `The date moved from ${formatDate(was.date)} to ${formatDate(now.date)}.`
        : `The date is still ${formatDate(now.date)}.`,
    };
  }

  if (was.kind === 'amount' && now.kind === 'amount') {
    const moved = cents(now.amount - was.amount);
    const of = cents(was.amount);
    // More than the margin, in whole cents so that exactly 5% is not a change.
    const changed = of === 0 ? moved > 0 : moved * 100 > of * AMOUNT_MARGIN_PERCENT;
    const span = `from ${formatAmount(was.amount)} to ${formatAmount(now.amount)}`;
    const percent = of === 0 ? null : ((moved / of) * 100).toFixed(1);
    let reason: string;
    if (moved === 0) reason = `The amount is still ${formatAmount(now.amount)}.`;
    else if (changed) reason = percent ? `The amount moved ${percent}%, ${span}.` : `The amount moved ${span}.`;
    else reason = `The amount moved ${percent}%, ${span}, within the ${AMOUNT_MARGIN_PERCENT}% margin.`;
    return { changed, from: base.answer, reason };
  }

  if (after.meaning) {
    return { changed: after.meaning.changed, from: base.answer, reason: after.meaning.reason };
  }
  const changed = words(base.answer) !== words(after.answer);
  return {
    changed,
    from: base.answer,
    reason: changed ? 'The wording changed and the routine gave no verdict on its meaning.' : 'The answer is unchanged.',
  };
}
