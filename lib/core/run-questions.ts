/**
 * A question Dash asks partway through a run, and your answer to it (plan
 * #1824).
 *
 * A session asks by writing a `question` line, which sets its run to
 * awaiting_input. You answer from the run's page or from the inbox, which
 * writes a `response` line as you. Then one of two things happens, depending
 * on whether the session is still there:
 *
 * - It is still waiting (it has not said it stopped): the run goes back to
 *   started, and the session reads the answer with `plan.ts response <n>` or
 *   the query in the goals skill, and carries on.
 * - It has stopped (a plan run's stopped_at, a goal run's ended_at): the run
 *   is closed, and a new one is fired with the question, your answer and the
 *   lines so far at the top of its brief (`continuationText`).
 *
 * The rules that need no database are here; the reads and writes are in
 * run-questions-store.ts, and each side's answer in lib/plan/run-answer.ts and
 * lib/goals/run-answer.ts.
 */
import { RUN_ACTIVITY_LABEL, type RunActivity, type RunTable } from './run-activities';

/** The longest answer, the same limit as any other line (run_activities_body_ck). */
export const RUN_ANSWER_MAX = 4000;

/** A choice and an answer compared as words: case and a closing full stop aside. */
export function choiceKey(text: string): string {
  return text.trim().replace(/[.!]+$/, '').toLowerCase();
}

/**
 * The question still waiting on you: the newest question line, when no
 * response has been written after it. Null when the run asked nothing or the
 * last question is answered.
 */
export function openQuestion(lines: readonly RunActivity[]): RunActivity | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line.kind === 'response') return null;
    if (line.kind === 'question') return line;
  }
  return null;
}

/**
 * Whether the run's question already has an answer under it: it asked, and
 * nothing is open. A second press, or a second tab, is refused on this.
 */
export function alreadyAnswered(lines: readonly RunActivity[]): boolean {
  return openQuestion(lines) === null && lines.some((line) => line.kind === 'question');
}

/** What a press on an answered question is told. */
export const ANSWERED = 'This question already has your answer. Reload to see where the run stands.';

/** What a press on a run that stopped waiting is told. */
export const NOT_WAITING = 'This run is not waiting on an answer any more. Reload to see where it stands.';

/**
 * The answer to the newest question, for a session reading it back: the
 * first response after that question. Null when there is no question, or no
 * answer to it yet.
 */
export function answerToLatest(
  lines: readonly RunActivity[],
): { question: RunActivity; answer: RunActivity } | null {
  let asked = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].kind === 'question') {
      asked = index;
      break;
    }
  }
  if (asked < 0) return null;
  const answer = lines.slice(asked + 1).find((line) => line.kind === 'response');
  return answer ? { question: lines[asked], answer } : null;
}

/** Your answer as it will be written, or why it cannot be. */
export function answerFrom(raw: unknown): { answer: string } | { refusal: string } {
  const answer = typeof raw === 'string' ? raw.trim() : '';
  if (!answer) return { refusal: 'Pick a choice or write an answer.' };
  if (answer.length > RUN_ANSWER_MAX) {
    return { refusal: `That is ${answer.length} characters; keep it under ${RUN_ANSWER_MAX}.` };
  }
  return { answer };
}

/**
 * Whether the session that asked has said it stopped, so an answer has to
 * start a new run rather than wake this one. A plan session says so with
 * `plan.ts stopped`, which stamps stopped_at; a goals session sets ended_at
 * and leaves the status awaiting_input.
 */
export function sessionHasLeft(runTable: RunTable, run: { stopped_at?: string | null; ended_at?: string | null }): boolean {
  return runTable === 'plan_runs' ? Boolean(run.stopped_at) : Boolean(run.ended_at);
}

/** How many of the earlier lines a continuation carries, newest kept. */
const CARRIED_LINES = 40;

/**
 * The opening of the brief a continued run is fired with: what the run
 * before it asked, what you answered, and the lines it wrote, so the new
 * session picks up where they leave off.
 */
export function continuationText(input: {
  runId: string;
  question: string;
  answer: string;
  lines: readonly RunActivity[];
}): string {
  const carried = input.lines.slice(-CARRIED_LINES);
  const skipped = input.lines.length - carried.length;
  const out = [
    '## Carrying on after your question',
    '',
    `The run before this one (${input.runId}) stopped to ask the person a question, and they ` +
      'have answered it. Pick up where its lines leave off, with their answer, and write your ' +
      'own lines on this run as usual. Do not redo what the lines say was done.',
    '',
    `Asked: ${input.question}`,
    `Answered: ${input.answer}`,
    '',
    '### What the run before wrote',
    '',
  ];
  if (skipped > 0) out.push(`(${skipped} earlier lines left out.)`);
  for (const line of carried) {
    out.push(`- ${RUN_ACTIVITY_LABEL[line.kind]}: ${line.body.replace(/\s+/g, ' ').trim()}`);
  }
  return out.join('\n');
}

/** One question waiting on you, as an inbox draws it. */
export type RunQuestion = {
  runTable: RunTable;
  runId: string;
  /** What the run is on, as the inbox names it: '#1824 Let Dash ask…' or a goal's title. */
  about: string;
  /** The run's own page, where its lines are. */
  href: string;
  /** The question, or null when the run is waiting but its question line cannot be found. */
  body: string | null;
  options: string[] | null;
  /** When it asked, or when the run started if the line is missing. */
  askedAt: string;
};
