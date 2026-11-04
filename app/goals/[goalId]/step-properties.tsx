import type { ReactNode } from 'react';
import { Property, PropertyList } from '@/components/shell/detail-layout';
import { formatDay } from '@/lib/goals/dates';
import type { GoalRowNode } from '@/lib/goals/plan-rows';
import { stepMove, STEP_MOVE_WORD } from '@/lib/goals/status';
import { dayIn } from '@/lib/todo/time';

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

/** One fact about the step, as the frame draws it. */
type Fact = { label: string; value: ReactNode; hint?: string; wide?: boolean };

/**
 * Every fact the step has, in the order they are read: status, then
 * progress, the dates and whose move it is. A fact the step lacks is left out
 * rather than said as a dash, and none repeats what the Overview already
 * shows: whose step it is is the picker there, and what it needs is its
 * Needs line (plan #2373.3). The dates are changed in the Overview; these
 * only say them. Status is the one fact you change here: `status` is its
 * menu (note 823e48a7), and without one it is the word.
 */
function stepFacts(
  node: Pick<GoalRowNode, 'health' | 'step' | 'children'>,
  status?: ReactNode,
): Fact[] {
  const { step } = node;
  const split = splitWords(node);
  const progress = progressWords(node);
  const facts: (Fact | false | null)[] = [
    { label: 'Status', hint: node.health.title, value: status ?? node.health.word },
    progress !== null && { label: 'Progress', value: progress },
    step.dueOn ? { label: 'Due', value: formatDay(step.dueOn) } : null,
    step.waitsUntil ? { label: 'Starts', value: formatDay(step.waitsUntil) } : null,
    split !== null && {
      // "Open", not "Open sub-steps", so the label fits its third of the phone's row.
      label: hasSubsteps(node) ? 'Open' : 'Whose move',
      value: split,
      wide: true,
      hint: hasSubsteps(node)
        ? 'Yours: your move. Dash’s: Dash is on them or can take them. Waiting: on another step or a date.'
        : undefined,
    },
  ];
  return facts.filter((fact): fact is Fact => Boolean(fact));
}

/**
 * The facts read first: one row on a phone, the head of the column from
 * laptop width. In that row no fact is wide, so the three stay on one line.
 */
const GLANCE = 3;

function FactList({ facts }: { facts: readonly Fact[] }) {
  return (
    <>
      {facts.map((fact) => (
        <Property key={fact.label} label={fact.label} value={fact.value} hint={fact.hint} wide={fact.wide} />
      ))}
    </>
  );
}

/**
 * The step's facts for the frame (plan #2373.1): the first three as the
 * glance, read first, and the rest folded under All details on a phone, with
 * how many there are. A step with no more than three facts has no fold:
 * they are the one row on a phone, laid out as the glance is.
 */
export function stepFactParts(
  node: Pick<GoalRowNode, 'health' | 'step' | 'children'>,
  status?: ReactNode,
): {
  glance?: ReactNode;
  detailCount?: number;
  properties: ReactNode;
} {
  const facts = stepFacts(node, status);
  const rest = facts.slice(GLANCE);
  if (rest.length === 0) {
    return {
      properties: (
        // The glance's own grid (PropertiesFold), so the facts stay one row on a phone.
        <dl className="grid grid-cols-3 gap-x-4 gap-y-3 lg:grid-cols-1 lg:gap-y-2.5">
          <FactList facts={facts.map((fact) => ({ ...fact, wide: false }))} />
        </dl>
      ),
    };
  }
  return {
    glance: <FactList facts={facts.slice(0, GLANCE).map((fact) => ({ ...fact, wide: false }))} />,
    // A fold over one fact joins the row on a phone (PropertiesFold); the
    // step keeps its row to three and folds the fourth, so the tabs stay high
    // (plan #2373.3). With no count the fold still says All details.
    detailCount: rest.length > 1 ? rest.length : undefined,
    properties: (
      <PropertyList>
        <FactList facts={rest} />
      </PropertyList>
    ),
  };
}
