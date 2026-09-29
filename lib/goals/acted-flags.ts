import type { JevQuestion } from '@/lib/jev/wire';

/**
 * Flagging a run that acted outside the plan (plan #1184).
 *
 * Plan #1183 holds a Claude step before a run works it when Jev thinks the
 * step would send, submit, book, buy or change records elsewhere. That check
 * reads the step as it was planned, and it misses a step a run adds and works
 * in the same sitting. This one reads what a run wrote once it has finished:
 * for every Claude step the run closed without an approved `acts` sentence,
 * Jev is asked whether the result says Dash did something outside the plan,
 * and a yes of 0.5 or more puts a flag on the goal (lib/goals/flags.ts)
 * naming the step and quoting the line. Nothing is undone.
 *
 * Only Claude steps are read. A step of the person's that a morning run
 * closes from evidence says what the person did ("Your application is in
 * Jobs, sent 12 September"), which would read as a yes and is not Dash's
 * action.
 *
 * Pure: acted-flags-store.ts reads the closes and writes the flags.
 */

/**
 * Jev's probability of a yes at or above which the goal is flagged. Higher
 * than the 0.3 that holds a step: a flag reports what already happened, so a
 * false one costs the person a read and buys nothing back.
 */
export const ACTED_FLAG_THRESHOLD = 0.5;

/** A flag from this check carries this source, then the step's id; one per step. */
export const ACTED_SOURCE_PREFIX = 'goals acts check ';

/** How far back a finished run is still read, so the first tick does not read every past run. */
export const ACTED_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Each field Jev reads is cut to this, since a result can run to a page. */
const FIELD_MAX = 2000;

/** The line quoted on the flag. */
const QUOTE_MAX = 300;

export const ACTED_QUESTION = {
  type: 'yes-no',
  question:
    'Does what the assistant wrote when it closed this step say it sent, submitted, booked, bought, shared, or changed records outside the goals schema?',
  yes:
    'It says the assistant sent an email or message, submitted a form or application, booked or bought something, posted or shared something, or changed a record in another app or service such as a to-do list, a calendar or a job tracker.',
  no:
    'It reports research, a list, a comparison, a calculation, a plan, or a draft left for the person to send, and nothing it describes left the plan.',
} as const satisfies JevQuestion;

/** A step a finished run closed, as the check reads it. */
export type ClosedStep = {
  id: string;
  runId: string;
  goalId: string;
  title: string;
  kind: string | null;
  acts: string | null;
  approvedAt: string | null;
  result: string | null;
  evidence: string | null;
  resolution: string | null;
};

/**
 * Whether the check reads this close. A Claude step only, and not one the
 * person approved with a sentence saying what it would do: that one was
 * allowed to act.
 */
export function actedCandidate(step: ClosedStep): boolean {
  if (step.kind !== 'claude') return false;
  if (step.acts?.trim() && step.approvedAt) return false;
  return Boolean(step.result?.trim() || step.evidence?.trim() || step.resolution?.trim());
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** What Jev reads: the step's title and what the run wrote when it closed it. */
export function actedState(step: ClosedStep): string {
  const lines = [`Step: ${step.title.trim()}`];
  if (step.result?.trim()) lines.push(`Result: ${cut(step.result.trim(), FIELD_MAX)}`);
  if (step.evidence?.trim()) lines.push(`Evidence: ${cut(step.evidence.trim(), FIELD_MAX)}`);
  if (step.resolution?.trim()) lines.push(`Closing note: ${cut(step.resolution.trim(), FIELD_MAX)}`);
  return lines.join('\n');
}

/** Markdown links and emphasis read as their text, on one line. */
function plain(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The first line of the result, or of the evidence or closing note when there is no result. */
export function resultLine(step: ClosedStep): string {
  for (const field of [step.result, step.evidence, step.resolution]) {
    const line = (field ?? '')
      .split('\n')
      .map(plain)
      .find((each) => each.length > 0);
    if (line) return cut(line, QUOTE_MAX);
  }
  return '';
}

export function actedAt(probability: number): boolean {
  return probability >= ACTED_FLAG_THRESHOLD;
}

export function actedSource(stepId: string): string {
  return `${ACTED_SOURCE_PREFIX}${stepId}`;
}

/** The raised_items row for a flagged step. */
export type ActedFlag = {
  goalId: string;
  title: string;
  detail: string;
  ask: string;
  source: string;
};

export function actedFlag(step: ClosedStep): ActedFlag {
  const name = cut(plain(step.title), 140);
  return {
    goalId: step.goalId,
    title: cut(`Dash may have acted outside the plan on "${name}"`, 200),
    detail: cut(
      [
        `A goals run closed the step "${name}" with this result: "${resultLine(step)}"`,
        '',
        'That reads as something sent, submitted, booked, bought or changed outside your goals. ' +
          'The step had no sentence you approved saying it would do that, so it should have waited for your approval. ' +
          'Nothing has been undone.',
      ].join('\n'),
      4000,
    ),
    ask: 'Check what was done and say whether anything needs putting right.',
    source: actedSource(step.id),
  };
}
