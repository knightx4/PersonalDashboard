import { Property, PropertyList } from '@/components/shell/detail-layout';
import { formatDay } from '@/lib/goals/dates';
import type { GoalRowNode } from '@/lib/goals/plan-rows';
import { stepMove, STEP_MOVE_WORD } from '@/lib/goals/status';
import { STEP_KIND_LABELS } from '@/lib/goals/steps';
import { dayIn } from '@/lib/todo/time';

/** What a fact the step lacks says (plan #2373.1). */
const NONE = '—';

/**
 * The one line under a step's title on its own page (plan #2373.1), as a
 * goal's says "Goal, added 3 Oct": what it is, and when it was added.
 */
export function stepLine(node: Pick<GoalRowNode, 'step'>, timeZone: string): string {
  const added = node.step.createdAt ? formatDay(dayIn(node.step.createdAt, timeZone)) : null;
  return added ? `Step, added ${added}` : 'Step';
}

/**
 * The step's own sub-steps, as the Sub-steps tab lists them: one level down,
 * without the questions, which are read on Overview (plan #2373.2). Every
 * count on the page is of these, so the tab's count, Progress, Open
 * sub-steps and the Finished fold agree.
 */
function subRows(node: Pick<GoalRowNode, 'children'>): GoalRowNode[] {
  return node.children.filter((child) => child.kind !== 'decision');
}

function isOpen(row: GoalRowNode): boolean {
  return row.status !== 'done' && row.status !== 'dropped';
}

/** How many of the step's own sub-steps are open: the Sub-steps tab's count. */
export function openSubsteps(node: Pick<GoalRowNode, 'children'>): number {
  return subRows(node).filter(isOpen).length;
}

/** How far through its sub-steps the step is, or null on a step with none. */
function progressWords(node: Pick<GoalRowNode, 'children'>): string | null {
  const rows = subRows(node).filter((row) => row.status !== 'dropped');
  if (rows.length === 0) return null;
  return `${rows.filter((row) => row.status === 'done').length} of ${rows.length} done`;
}

/**
 * Whose move the step is: its open sub-steps split between you and Dash, as
 * a goal's Open steps says it, or on a step with none beneath, its own move.
 * Null on a closed step, which has no move.
 */
function splitWords(node: Pick<GoalRowNode, 'step' | 'children'>): string | null {
  const { step } = node;
  if (!hasSubsteps(node)) return STEP_MOVE_WORD[stepMove(step)] || null;
  const bands = { on_you: 0, with_dash: 0, waiting: 0 };
  for (const row of subRows(node).filter(isOpen)) {
    const move = stepMove(row.step);
    if (move !== 'settled') bands[move] += 1;
  }
  const words = [
    bands.on_you > 0 && `${bands.on_you} yours`,
    bands.with_dash > 0 && `${bands.with_dash} Dash’s`,
    bands.waiting > 0 && `${bands.waiting} waiting`,
  ]
    .filter(Boolean)
    .join(' · ');
  return words || null;
}

/** Whether the step has sub-steps, which is when its progress is read first. */
function hasSubsteps(node: Pick<GoalRowNode, 'children'>): boolean {
  return subRows(node).length > 0;
}

/** When it is due, or a dash. */
function dueWords(node: Pick<GoalRowNode, 'step'>): string {
  return node.step.dueOn ? formatDay(node.step.dueOn) : NONE;
}

/**
 * The step's facts read first: its status, what kind of step it is, and how
 * far through its sub-steps it is, or when it is due on a step with none
 * beneath. One row on a phone, with the rest under All details; the head of
 * the column from laptop width.
 */
export function StepGlance({
  node,
}: {
  node: Pick<GoalRowNode, 'health' | 'step' | 'children'>;
}) {
  return (
    <>
      <Property label="Status" hint={node.health.title} value={node.health.word} />
      <Property label="Kind" value={STEP_KIND_LABELS[node.step.kind]} />
      {hasSubsteps(node) ? (
        <Property label="Progress" value={progressWords(node) ?? NONE} />
      ) : (
        <Property label="Due" value={dueWords(node)} />
      )}
    </>
  );
}

/** How many facts `StepProperties` draws, said on the closed fold on a phone. */
export function stepDetailCount(node: Pick<GoalRowNode, 'step' | 'children'>): number {
  return (hasSubsteps(node) ? 3 : 2) + (node.step.waitsUntil ? 1 : 0);
}

/**
 * The rest of the step's facts in the properties column (plan #2373.1): when
 * it is due (unless the glance says it) and when it can start, what it waits on, and whose move it is.
 * A fact the step lacks says a dash, so the column keeps its shape from one
 * step to the next. The dates are changed in the step's panel; these only
 * say them.
 */
export function StepProperties({
  node,
}: {
  node: Pick<GoalRowNode, 'step' | 'need' | 'children'>;
}) {
  const { step } = node;
  const split = splitWords(node);
  return (
    <PropertyList>
      {/* Due is read first on a step with no sub-steps (StepGlance). */}
      {hasSubsteps(node) && <Property label="Due" value={dueWords(node)} />}
      {step.waitsUntil && <Property label="Starts" value={formatDay(step.waitsUntil)} />}
      <Property
        label={hasSubsteps(node) ? 'Open sub-steps' : 'Whose move'}
        wide
        hint={
          hasSubsteps(node)
            ? 'Yours: your move. Dash’s: Dash is on them or can take them. Waiting: on another step or a date.'
            : undefined
        }
        value={split ?? NONE}
      />
      <Property label="Waiting on" wide hint={node.need ?? undefined} value={node.need ?? NONE} />
    </PropertyList>
  );
}
