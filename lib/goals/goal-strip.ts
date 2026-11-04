/**
 * The Now / Next / Later strip at the top of a goal's Dashboard (plan
 * #2778.4): what is on you now, the step that comes after it, and what waits
 * beyond that, each going to its row on the Plan tab.
 *
 * Each card is the first of its lane on the Plan tab (lib/goals/plan-order.ts,
 * plan #2778.5), so the strip and the Plan tab name the same steps.
 *
 * Pure: the page passes in the goal's tree and its status.
 */
import { formatDay } from '@/lib/goals/dates';
import { stepAnchor } from '@/lib/goals/goal-page';
import type { StatusRow } from '@/lib/goals/goal-status';
import { planOrder, whoseLine, type PlanEntry, type PlanOrder } from '@/lib/goals/plan-order';
import type { StepNode } from '@/lib/goals/steps';

export type StripCard = {
  id: string;
  title: string;
  /** What to do, when, or what it waits on, in a few words; null for nothing to say. */
  line: string | null;
  /** Where on the page it is done. */
  href: string;
  /** A step of yours that Done can close from the card (Now only). */
  canClose?: boolean;
  /**
   * What the Now card's button says when the step is done somewhere else,
   * such as Answer for a question; the button opens it (plan #2778.11).
   */
  action?: string;
};

export type GoalStrip = {
  /** What is on you now; null when nothing is. */
  now: StripCard | null;
  next: StripCard | null;
  later: StripCard | null;
  /** How many open steps Later holds beyond the one it names. */
  laterMore: number;
};

function card(entry: PlanEntry, line: string | null): StripCard {
  return { id: entry.id, title: entry.node.title, line, href: stepAnchor(entry.id) };
}

/**
 * The strip, read from the Plan tab's order so the two never disagree: Now is
 * the plan's first Now step, Next the step numbered after it, and Later the
 * first of Later with what it waits on. With no step of yours ready, Now is
 * the first thing Waiting on you lists, such as a flag or a proposal.
 */
export function goalStrip(
  steps: readonly StepNode[],
  yourMove: readonly StatusRow[],
  order: PlanOrder = planOrder(steps),
): GoalStrip {
  const [first, ...rest] = order.now;
  const fallback = first ? undefined : yourMove.find((row) => row.kind !== 'do');
  const now: StripCard | null = first
    ? {
        ...card(first, first.whose === 'question' ? null : nowLine(first)),
        canClose: first.whose === 'you',
        ...(first.whose === 'question' ? { action: 'Answer' } : {}),
      }
    : fallback
      ? { id: fallback.id, title: fallback.title, line: null, href: fallback.href, canClose: false, action: fallback.label }
      : null;
  const nextEntry = [...rest, ...order.next][0] ?? null;
  const laterEntry = order.later[0] ?? null;
  return {
    now,
    next: nextEntry ? card(nextEntry, whoseLine(nextEntry)) : null,
    later: laterEntry
      ? card(laterEntry, laterEntry.waits?.detail ?? laterEntry.waits?.label ?? whoseLine(laterEntry))
      : null,
    laterMore: Math.max(0, order.later.length - 1),
  };
}

/** Now's line: when it is due, or nothing to say. */
function nowLine(entry: PlanEntry): string {
  return entry.node.dueOn ? `Do by ${formatDay(entry.node.dueOn)}` : 'Do';
}
