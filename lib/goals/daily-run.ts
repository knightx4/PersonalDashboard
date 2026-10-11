/**
 * The morning run (docs/GOALS-SPEC.md, "What Claude does, and when"; plan
 * #933).
 *
 * Each morning the daily cron fires the goals routine once for the owner,
 * while there is an open goal. The run first gives every open goal its status
 * for the day (plan #1074; lib/goals/reviews.ts), then works each Claude step
 * that is ready, stores what it produced on the step and closes it, and the
 * home lists the result as waiting on you until you mark it read.
 *
 * The rules that need no database live here: which steps are ready, whether
 * a run already happened today, and the brief the routine is fired with. The
 * reads and writes are in inngest/goals/daily.ts.
 */
import type { OutOfDateStep } from '@/lib/goals/answers';
import { isStaleStepBlock, waitsOnNothing } from '@/lib/goals/dependencies';
import { focusActive, inFocus } from '@/lib/goals/focus';
import { prepLine, type PrepCandidate } from '@/lib/goals/prep-candidates';
import { underWayLine, type ProgressNudges } from '@/lib/goals/progress-nudges';
import { reviewLines, type ReviewGoal } from '@/lib/goals/reviews';
import { staleLine, type StaleStep } from '@/lib/goals/stale-steps';
import type { StepNode } from '@/lib/goals/steps';
import type { Goal } from '@/lib/goals/tree';

/** More than this many and the rest wait for tomorrow, so one run stays one sitting. */
export const DAILY_STEP_LIMIT = 10;

/**
 * How long after one morning run another is refused. Less than a day, so a
 * cron that fires a little early tomorrow still runs, and more than a retry
 * window, so a retried cron today does not spend a second run.
 */
export const DAILY_GAP_MS = 20 * 60 * 60 * 1000;

export type ReadyStep = {
  id: string;
  title: string;
  goalId: string;
  goalTitle: string;
  /**
   * Set when its goal is in this week's focus while a focus is chosen
   * (lib/goals/focus.ts). Absent when no focus is chosen or the goal is not
   * in it.
   */
  focus?: true;
};

/**
 * Every Claude step the morning run should work, in page order: an open
 * `claude` step under an open goal, reached through open steps only, with no
 * open step beneath it and nothing produced yet. A step with open sub-steps
 * waits on them, as on the home, and so does one waiting on other steps
 * (plan #981). A blocked step and what is under it wait on you. A step whose
 * start date has not come waits for it, with everything under it; the
 * caller marks those with markStartDates.
 *
 * While the person has chosen the week's focus, the steps of goals in focus
 * come first, each group in page order, so DAILY_STEP_LIMIT spends its slots
 * on them and other goals' steps fill what is left. `today` lets an errand
 * due within a week count as in focus.
 */
export function readyClaudeSteps(
  goals: Goal[],
  stepsByGoal: Map<string, StepNode[]>,
  today?: string,
): ReadyStep[] {
  const ready: ReadyStep[] = [];
  const active = focusActive(goals);
  for (const goal of goals) {
    if (goal.status !== 'open') continue;
    const focus = active && inFocus(goal, goals, today);
    const walk = (nodes: StepNode[]) => {
      for (const node of nodes) {
        if (node.status !== 'open' && !isStaleStepBlock(node)) continue;
        if (node.waitsUntil) continue;
        if (
          node.kind === 'claude' &&
          node.result === null &&
          node.resultUrl === null &&
          waitsOnNothing(node)
        ) {
          ready.push({
            id: node.id,
            title: node.title,
            goalId: goal.id,
            goalTitle: goal.title,
            ...(focus && { focus: true as const }),
          });
        }
        walk(node.children);
      }
    };
    walk(stepsByGoal.get(goal.id) ?? []);
  }
  return active ? [...ready.filter((s) => s.focus), ...ready.filter((s) => !s.focus)] : ready;
}

/** Whether a morning run was started recently enough that today's is done. */
export function ranRecently(lastDailyRunAt: string | null, now: number): boolean {
  if (!lastDailyRunAt) return false;
  return now - Date.parse(lastDailyRunAt) < DAILY_GAP_MS;
}

/**
 * The turn appended to the goals routine's standing prompt for the morning
 * run. It names the account and the run row already written, then the steps
 * of the person's that have sat for a week and need a move (plan #1083),
 * then the steps of theirs not yet judged for a Dash prep step (plan #1217),
 * then every open goal to give a status (plan #1074), then the steps to work
 * and the information steps whose answers are out of date (plan #989), so
 * the session does not have to decide what is ready or what has sat. When a
 * collection has senders to search, the new statements come first (plan
 * #1023), so the goals are reviewed on current figures.
 */
export function dailyRunText(input: {
  userId: string;
  runId: string;
  steps: ReadyStep[];
  answers?: OutOfDateStep[];
  review?: ReviewGoal[];
  stale?: StaleStep[];
  /**
   * The person's steps under way that have stalled, and those whose tally
   * reached its total (plan #1281; progressNudges in
   * lib/goals/progress-nudges.ts).
   */
  underWay?: ProgressNudges;
  /**
   * The steps of the person's not judged yet for a Dash prep step, at most
   * ten, newest first (plan #1217; prepCandidates in
   * lib/goals/prep-candidates.ts).
   */
  unjudged?: PrepCandidate[];
  /**
   * The evidence Jev kept for the person's steps (plan #1176; evidenceLines
   * in lib/goals/evidence.ts). Null or absent when Jev could not filter, and
   * the session then searches Jobs, Gmail, the calendar and Todo itself.
   */
  evidence?: string[] | null;
  /**
   * The collections to read new Gmail statements into, first thing (plan
   * #1023; statementLines in lib/goals/statements.ts). Absent or empty when
   * no collection has a sender to search.
   */
  statements?: string[];
}): string {
  const answers = input.answers ?? [];
  const review = input.review ?? [];
  const sitting = input.stale ?? [];
  const unjudged = input.unjudged ?? [];
  const stalled = input.underWay?.stalled ?? [];
  const finished = input.underWay?.finished ?? [];
  const lines = input.steps.map(
    (step) =>
      `- "${step.title}" (goals.items id ${step.id}), under the goal "${step.goalTitle}"` +
      (step.focus ? ', one of this week\'s focus goals' : ''),
  );
  const stale = answers.map(
    (step) =>
      `- "${step.title}" (goals.items id ${step.id}), under the goal "${step.goalTitle}": ` +
      step.questions.map((q) => `"${q}"`).join(', '),
  );
  return [
    'The morning run.',
    '',
    ...(input.statements ?? []),
    ...(review.length > 0
      ? [
          ...(input.evidence
            ? [
                'First, close each step of the person\'s under these goals that the evidence below',
                'shows has happened, setting evidence and evidence_source with the close. Follow',
                '.claude/skills/goals/SKILL.md, "Closing a step from evidence".',
                '',
                ...input.evidence,
                '',
              ]
            : [
                'First, close each step of the person\'s under these goals that you can see has happened',
                '(in Jobs, Gmail, their calendar or Todo), setting evidence and evidence_source with the',
                'close. Follow .claude/skills/goals/SKILL.md, "Closing a step from evidence".',
                '',
              ]),
          ...(sitting.length > 0
            ? [
                'Then give each of these steps of the person\'s a move. Nothing has touched them in a',
                'week or more. Split it into smaller sub-steps, prepare it for them, or ask beside it',
                'whether they still want it and make it wait on that question. Leave one you just',
                'closed from evidence or merged. Follow .claude/skills/goals/SKILL.md, "Moving a step',
                'that has sat for a week".',
                '',
                ...sitting.map(staleLine),
                '',
              ]
            : []),
          ...(stalled.length > 0
            ? [
                'Then nudge each of these steps of the person\'s. Each is under way, and nothing has',
                'been logged on it for a week or more. Follow .claude/skills/goals/SKILL.md, "Steps',
                'under way", on nudging a stalled one.',
                '',
                ...stalled.map(underWayLine),
                '',
              ]
            : []),
          ...(finished.length > 0
            ? [
                'Then offer to close each of these steps of the person\'s, and do not close them. The',
                'tally has reached the step\'s estimated total, or they said it is nearly done. Follow',
                '.claude/skills/goals/SKILL.md, "Steps under way", on offering to close one.',
                '',
                ...finished.map(underWayLine),
                '',
              ]
            : []),
          ...(unjudged.length > 0
            ? [
                'Then judge each of these steps of the person\'s for a Dash step before it. None has',
                'been judged yet. Where a draft, research or a list would help them do it, add a',
                'claude step just before it with prepares_id set to it. Set prep_checked_at on each',
                'one either way, so it is not listed again. Follow .claude/skills/goals/SKILL.md,',
                '"A Dash step before yours".',
                '',
                ...unjudged.map(prepLine),
                '',
              ]
            : []),
          'Then give every open goal below its status for today: one row in goals.reviews each,',
          'with a verdict of met, on_track, stalled, waiting_on_you, waiting_on_date or',
          'waiting_on_goal, one sentence on why, one on the next move, and next_on for the next',
          'move\'s date where it has one. A goal whose done-when is met reads met, with a short',
          'summary of how it got there as the reason: that is the proposal to close it, and closing',
          'stays the person\'s. A stalled goal also gets that next move as a step under it, named as',
          'step_id; a goal waiting on a date needs next_on; one waiting on another goal names it as',
          'waits_on_id. Follow .claude/skills/goals/SKILL.md, "Reviewing each goal".',
          '',
          ...review.flatMap((g) => [...reviewLines(g), '']),
        ]
      : []),
    ...(input.steps.length > 0
      ? [
          review.length > 0 ? 'Then work the Claude steps that are ready:' : 'Work the Claude steps that are ready:',
          '',
          ...lines,
          '',
          'Follow .claude/skills/goals/SKILL.md, the section "The morning run". For each step,',
          'produce what its title and done-when ask for, store it in the step\'s result (and',
          'result_url when it lives somewhere with a link), and close the step as done. Anything',
          'longer than a few lines goes in a file linked from the step, with its summary as the',
          'result (the section "Files"). Then add the next move each result leads to (point 5 of',
          'that section), so no goal is left with every step finished. A step you cannot finish',
          'stays open, with the reason in the run summary.',
          '',
        ]
      : review.length > 0
        ? ['No Claude step is ready today.', '']
        : []),
    ...(answers.length > 0
      ? [
          'These information steps have answers out of date, since a row they read has changed:',
          '',
          ...stale,
          '',
          'Work each one again from the step\'s records, as in the section "Answers on an',
          'information step", and write it back with its sources.',
          '',
        ]
      : []),
    ...(input.steps.length > 0
      ? [
          'Before closing the run, leave a note on each goal you worked and one for the Goals home',
          '(the section "Leaving a note").',
          '',
        ]
      : []),
    `The goals belong to user_id ${input.userId}. This run is goals.runs id ${input.runId},`,
    'already written as started. Set goals.run_id to it on every write, and run_id on every',
    'review, and close that row with a summary (or as failed, with the reason) before you stop.',
  ].join('\n');
}
