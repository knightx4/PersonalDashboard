/**
 * The box at the top of a goal's page: where the goal stands and what is
 * waiting on you in it.
 *
 * What is waiting is worked out the same way the Goals home works it out, by
 * running dailyView over this one goal, so the two pages never disagree about
 * what is yours. The flags on the goal come from public.raised_items and are
 * passed in. Claude's own note on the goal (goals.briefs) and the weekly
 * verdict (goals.reviews) sit beside this in the box; they are read, not
 * worked out.
 *
 * Pure. The page passes in the goal's tree and flags.
 */
import { dailyView, type WaitingItem } from '@/lib/goals/daily';
import { formatDay } from '@/lib/goals/dates';
import { stepAnchor } from '@/lib/goals/goal-page';
import type { StepNode } from '@/lib/goals/steps';
import type { Goal } from '@/lib/goals/tree';

export type StatusRowKind = 'question' | 'flag' | 'approve' | 'read' | 'do';

export type StatusRow = {
  id: string;
  kind: StatusRowKind;
  /** What to do, in a few words. */
  label: string;
  /** The step or thing it is about. */
  title: string;
  /** Where on the page it is done. */
  href: string;
};

export type GoalStatusView = {
  /** What is yours to move on this goal, most pressing first. */
  yourMove: StatusRow[];
  /** Steps of yours that are ready, beyond the ones listed. */
  moreSteps: number;
  /** Claude steps the next run will work. */
  claudeReady: number;
  /** Claude steps waiting until you approve what they sit under. */
  claudeHeld: number;
};

/** The most of your own ready steps the box lists; the tree has the rest. */
export const STATUS_STEPS_SHOWN = 3;

/** The first proposed step in the tree, which is where approving starts. */
function firstProposed(nodes: readonly StepNode[]): string | null {
  for (const node of nodes) {
    if (node.status === 'proposed') return node.id;
    const inner = firstProposed(node.children);
    if (inner) return inner;
  }
  return null;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function waitingRow(item: WaitingItem, steps: readonly StepNode[]): StatusRow | null {
  switch (item.kind) {
    case 'question':
      return { id: item.id, kind: 'question', label: 'Answer', title: item.title, href: stepAnchor(item.id) };
    case 'flag':
      return { id: item.id, kind: 'flag', label: 'Dash flagged', title: item.title, href: `#flag-${item.id}` };
    case 'breakdown': {
      const first = firstProposed(steps);
      return {
        id: item.id,
        kind: 'approve',
        label: 'Approve',
        title: plural(item.count, 'proposed step', 'proposed steps'),
        href: first ? stepAnchor(first) : '#claude-heading',
      };
    }
    case 'plan':
      return { id: item.id, kind: 'approve', label: 'Approve', title: 'This goal, which Dash proposed', href: '#claude-heading' };
    case 'review':
      return { id: item.id, kind: 'read', label: 'Read Dash’s result', title: item.title, href: stepAnchor(item.id) };
    case 'context':
      return {
        id: item.id,
        kind: 'read',
        label: 'Keep or dismiss',
        title: plural(item.count, 'thing Dash found', 'things Dash found'),
        href: '#context-heading',
      };
    case 'drafts':
      // Read by the goals home from outside the tree; the goal page shows
      // drafts on their information step.
      return null;
  }
}

/**
 * What is waiting on you in one goal, and what Claude has lined up. `flags`
 * are the goal's open flags as waiting rows.
 */
export function goalStatus(
  goal: Goal,
  areaName: string,
  steps: StepNode[],
  today: string,
  flags: readonly WaitingItem[] = [],
): GoalStatusView {
  const view = dailyView([{ goal, areaName }], new Map([[goal.id, steps]]), today);
  const waiting = [...flags, ...view.waiting]
    .map((item) => waitingRow(item, steps))
    .filter((row): row is StatusRow => row !== null);
  const daily = view.goals[0];
  const next = daily?.next ?? [];
  const shown = next.slice(0, STATUS_STEPS_SHOWN);
  const doRows: StatusRow[] = shown.map((item) => ({
    id: item.id,
    kind: 'do',
    label: item.dueOn ? `Do by ${formatDay(item.dueOn)}` : 'Do',
    title: item.title,
    href: stepAnchor(item.id),
  }));
  return {
    yourMove: [...waiting, ...doRows],
    moreSteps: next.length - shown.length + (daily?.more ?? 0),
    claudeReady: view.dash.ready.length,
    claudeHeld: view.dash.held.reduce((sum, held) => sum + held.count, 0),
  };
}

/** The line under the list about Claude's side, or null when Claude has nothing lined up. */
export function claudeLine(view: Pick<GoalStatusView, 'claudeReady' | 'claudeHeld'>): string | null {
  const parts: string[] = [];
  if (view.claudeReady > 0) {
    parts.push(`Dash will work ${plural(view.claudeReady, 'step', 'steps')} on its next run`);
  }
  if (view.claudeHeld > 0) {
    parts.push(`${plural(view.claudeHeld, 'Dash step waits', 'Dash steps wait')} for your approval`);
  }
  return parts.length > 0 ? `${parts.join('. ')}.` : null;
}

/**
 * The one line under the goal's title that says where it stands, from what
 * the page has already read: "3 on you · Dash on 1 · due 31 Oct". How many
 * things are on you (everything Waiting on you lists, and every step of
 * yours that is ready), how many runs Dash has going on the goal or else how
 * many of its steps the next run will work, the goal's due date, and the day
 * anything on it last moved.
 */
export function statusLine(
  view: Pick<GoalStatusView, 'yourMove' | 'moreSteps' | 'claudeReady'>,
  {
    running = 0,
    dueOn = null,
    lastProgressOn = null,
  }: { running?: number; dueOn?: string | null; lastProgressOn?: string | null } = {},
): string {
  const onYou = view.yourMove.length + view.moreSteps;
  return [
    onYou > 0 ? `${onYou} on you` : 'Nothing on you',
    running > 0
      ? `Dash on ${running}`
      : view.claudeReady > 0
        ? `${plural(view.claudeReady, 'step', 'steps')} ready for Dash`
        : null,
    dueOn ? `due ${formatDay(dueOn)}` : null,
    lastProgressOn ? `last progress ${formatDay(lastProgressOn)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
