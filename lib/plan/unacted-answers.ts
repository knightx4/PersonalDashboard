/**
 * Answered steps that no session was ever sent to.
 *
 * The plan page sends a step to a session as soon as an answer lifts its
 * block. That covers the answers typed there. It does not cover an answer
 * Dash wrote, one written by hand through SQL, or one whose send failed: on
 * 7 October five steps answered "yes" and "continue" went back to not started
 * and sat there for days. The overnight tick reads the plan with this on
 * every tick and sends what it finds (`sendUnactedAnswers`).
 *
 * A step is found when all of these hold:
 *
 * - it is `not_started`. A step in progress has a session on it, or a stale
 *   claim the claim sweep puts back first; done, dropped, proposed and
 *   blocked steps have nothing for a session to do on an answer.
 * - its newest dated history line is an `Answered …` or `Accepted …` line,
 *   and an older `Blocked …` line exists. A later line of any kind, such as
 *   `Next …` or the `Sent …` line the backstop writes after sending it, means
 *   something has happened since the answer.
 * - no run that started has been sent at it, or at a row above it, since that
 *   line. A feature run covers every step beneath it.
 *
 * Dates. History lines carry only the day (`Answered 2026-10-11:`), and runs
 * carry a time. A run on a later day is after the line, and one on an earlier
 * day is before it. A run on the same day is compared with the answer's exact
 * time, taken from the first of these that falls on the line's day:
 *
 * - the step leaving `blocked` in `plan_history` (plan #1830). Every answer
 *   moves the step from blocked to not started in the same write as its
 *   line, whoever wrote it: the page, Dash, or SQL by hand.
 * - the person's thread turn with the same words, which `answerBlockedStep`
 *   writes beside the line.
 * - the `accepted` round an accept writes.
 *
 * The history began on 12 October 2026, so the other two are for answers
 * given before then. When none exists the same-day run is counted as
 * earlier, and the step is sent. That rule can send a step a second time
 * only for an answer older than the history, when a same-day run came after
 * it and ended without closing or blocking it; it never sends twice for the
 * backstop's own send, because the `Sent …` line it writes becomes the newest
 * line. Counting the run as later instead would leave an answer given in the
 * evening unread whenever a session had run the step that morning, which is
 * the usual order: a session blocks, then the person answers.
 */

/** One dated line on a step's history: `Blocked 2026-10-11: …`. */
export type HistoryLine = { word: string; date: string; text: string };

/** A line that opens with one or two words and a date, as the plan writes them. */
const HISTORY_LINE = /^([A-Z][a-z]+(?: [a-z]+)?) (\d{4}-\d{2}-\d{2})\b:?\s*(.*)$/;

/** The dated lines on a step's history, oldest first. */
export function historyLines(comment: string | null | undefined): HistoryLine[] {
  if (!comment) return [];
  const out: HistoryLine[] = [];
  for (const raw of comment.split('\n')) {
    const m = HISTORY_LINE.exec(raw.trim());
    if (m) out.push({ word: m[1], date: m[2], text: m[3].trim() });
  }
  return out;
}

/** The line the backstop adds to a step's history after sending it. */
export function backstopSentLine(date: string): string {
  return (
    `Sent ${date}: the answer above had not reached a session, so Dash sent the step to one.`
  );
}

/** A step as the finder reads it. */
export type AnswerStep = {
  id: string;
  number: number;
  status: string;
  /** The row above it, so a run sent at its feature counts. */
  parentId: string | null;
  comment: string | null;
  /** The person's turns on the step's thread. */
  turns: readonly { body: string; createdAt: string }[];
  /** When each `accepted` round for the step was written. */
  acceptedAt: readonly string[];
  /** When `plan_history` recorded the step leaving `blocked`, if ever. */
  unblockedAt?: readonly string[];
};

/** A run that started, by the row it was sent at. */
export type AnswerRun = { planItemId: string; createdAt: string };

/** A step whose answer no session has been sent to. */
export type UnactedAnswer = {
  id: string;
  number: number;
  /** The answer line's day. */
  date: string;
  /** The exact time of the answer, when the app knows it. */
  answeredAt: string | null;
};

const day = (iso: string): string => new Date(iso).toISOString().slice(0, 10);

/** The newest of the times that fall on the given day, or null. */
function newestOn(date: string, times: readonly string[]): string | null {
  let best: string | null = null;
  for (const at of times) {
    if (!Number.isFinite(Date.parse(at)) || day(at) !== date) continue;
    if (best === null || Date.parse(at) > Date.parse(best)) best = at;
  }
  return best;
}

/** Whether a run counts as sent after the answer, by the rule above. */
function runAfter(run: string, date: string, answeredAt: string | null): boolean {
  const at = Date.parse(run);
  if (!Number.isFinite(at)) return false;
  if (answeredAt) return at >= Date.parse(answeredAt);
  return day(run) > date;
}

/**
 * The answered steps to send, oldest answer first, so the answer that has
 * waited longest goes first when the tick sends one at a time.
 */
export function unactedAnswers(
  steps: readonly AnswerStep[],
  runs: readonly AnswerRun[],
): UnactedAnswer[] {
  const parents = new Map(steps.map((step) => [step.id, step.parentId]));
  const runsOn = new Map<string, string[]>();
  for (const run of runs) {
    const list = runsOn.get(run.planItemId) ?? [];
    list.push(run.createdAt);
    runsOn.set(run.planItemId, list);
  }

  const out: UnactedAnswer[] = [];
  for (const step of steps) {
    if (step.status !== 'not_started') continue;
    const lines = historyLines(step.comment);
    const newest = lines[lines.length - 1];
    if (!newest || (newest.word !== 'Answered' && newest.word !== 'Accepted')) continue;
    if (!lines.some((line) => line.word === 'Blocked')) continue;

    const answeredAt =
      newestOn(newest.date, step.unblockedAt ?? []) ??
      (newest.word === 'Answered'
        ? newestOn(
            newest.date,
            // The line holds the answer's first line; the turn holds all of it.
            step.turns
              .filter((turn) => turn.body.trim().split('\n')[0].trim() === newest.text)
              .map((turn) => turn.createdAt),
          )
        : newestOn(newest.date, step.acceptedAt));

    // The step and every row above it, guarding against a loop in bad data.
    const covering: string[] = [];
    for (let at: string | null = step.id; at && !covering.includes(at); at = parents.get(at) ?? null) {
      covering.push(at);
    }
    const acted = covering.some((rowId) =>
      (runsOn.get(rowId) ?? []).some((run) => runAfter(run, newest.date, answeredAt)),
    );
    if (acted) continue;

    out.push({ id: step.id, number: step.number, date: newest.date, answeredAt });
  }
  return out.sort((a, b) => (a.date === b.date ? a.number - b.number : a.date < b.date ? -1 : 1));
}
