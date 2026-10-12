/**
 * One line a session writes onto its run (plan #1823), through
 * `plan.ts activity <n> --kind … --body "…"`. The line goes into
 * core.run_activities (plan #1822) against the plan run fired at the step or
 * at a row above it, found the way `plan.ts stopped` finds it.
 *
 * The limits match run_activities_body_ck and run_activities_options_ck
 * (0197), so a refusal here names the problem before the database does.
 */
import { RUN_ACTIVITY_KINDS, type RunActivityKind } from '../core/run-activities';

export const RUN_LINE_MAX = 4000;
export const RUN_OPTIONS_MAX = 10;

/** A session writes what it thinks, does, asks and hits. The answer is the person's. */
export const SESSION_LINE_KINDS: readonly RunActivityKind[] = RUN_ACTIVITY_KINDS.filter(
  (kind) => kind !== 'response',
);

export type RunLine = {
  kind: RunActivityKind;
  body: string;
  options: string[] | null;
};

/** The line as the database will hold it, or why it cannot be. */
export function runLine(
  kind: string | null,
  body: string | null,
  options: readonly string[],
): { line: RunLine } | { refusal: string } {
  if (!kind || !(SESSION_LINE_KINDS as readonly string[]).includes(kind)) {
    return { refusal: `--kind is one of ${SESSION_LINE_KINDS.join(', ')}. A response is the person's.` };
  }
  const text = (body ?? '').trim();
  if (!text) return { refusal: 'Say what the line is: --body "…".' };
  if (text.length > RUN_LINE_MAX) {
    return { refusal: `The line is ${text.length} characters; keep it under ${RUN_LINE_MAX}.` };
  }
  const choices = options.map((option) => option.trim());
  if (kind !== 'question') {
    if (choices.length > 0) return { refusal: '--option is for a question only.' };
    return { line: { kind: kind as RunActivityKind, body: text, options: null } };
  }
  if (choices.length === 0) return { line: { kind: 'question', body: text, options: null } };
  if (choices.length > RUN_OPTIONS_MAX) {
    return { refusal: `${choices.length} options is more than ${RUN_OPTIONS_MAX}.` };
  }
  if (choices.some((option) => !option)) return { refusal: 'An option is empty.' };
  return { line: { kind: 'question', body: text, options: choices } };
}

/**
 * What `plan.ts response <n>` prints (plan #1824): the person's answer to the
 * run's newest question, or that there is none yet and what to do about it.
 * The lines are the run's, oldest first.
 */
export function runResponse(lines: readonly { kind: string; body: string }[]): string {
  let asked = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].kind === 'question') {
      asked = index;
      break;
    }
  }
  if (asked < 0) return 'This run has asked nothing.';
  const question = lines[asked].body;
  const answer = lines.slice(asked + 1).find((line) => line.kind === 'response');
  if (answer) return `Answered: ${answer.body}\n(The question was: ${question})`;
  return (
    `No answer yet to: ${question}\n` +
    'Carry on with whatever does not depend on it and check again. If nothing is left, end the ' +
    'run with `stopped <n> --reason "Waiting on your answer: …"`; the answer then starts a new ' +
    'run with it in the brief.'
  );
}

/**
 * The run's status after the line. A question parks the run on the person;
 * any other line from the session means it is working again, which clears a
 * wait or a stale mark. A finished or failed run keeps its status.
 */
export function statusAfterLine(status: string, kind: RunActivityKind): string {
  if (status === 'finished' || status === 'failed') return status;
  if (kind === 'question') return 'awaiting_input';
  return status === 'awaiting_input' || status === 'stale' ? 'started' : status;
}
