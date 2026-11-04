/**
 * The Now / Next / Later strip at the top of a goal's Dashboard (plan
 * #2778.4): what is on you now, the step that comes after it, and what waits
 * beyond that, each going to its row on the Plan tab.
 *
 * Now is the first thing Waiting on you lists (an answer, an approval, a
 * result to read, a step to do), so the strip and the status never disagree.
 * Next is the first open step after it that nothing holds back, and Later the
 * first of the rest with what it waits on and how many more there are. Plan
 * #2778.5 orders the Plan tab the same way in lib/goals/plan-order.ts, and
 * the strip can read that ordering once it exists.
 *
 * Pure: the page passes in the goal's tree and its status.
 */
import { formatDay } from '@/lib/goals/dates';
import { stepAnchor } from '@/lib/goals/goal-page';
import type { StatusRow } from '@/lib/goals/goal-status';
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
};

export type GoalStrip = {
  /** What is on you now; null when nothing is. */
  now: StripCard | null;
  next: StripCard | null;
  later: StripCard | null;
  /** How many open steps Later holds beyond the one it names. */
  laterMore: number;
};

const OPEN = new Set(['open', 'blocked']);

/**
 * The open steps nothing beneath stands for, in tree order: a step with open
 * steps under it is done by doing those, so they are listed instead. Rhythms
 * are left out, being kept up rather than reached.
 */
export function openLeaves(nodes: readonly StepNode[]): StepNode[] {
  const out: StepNode[] = [];
  for (const node of nodes) {
    if (!OPEN.has(node.status) || node.kind === 'rhythm') continue;
    const inner = openLeaves(node.children);
    if (inner.length > 0) out.push(...inner);
    else out.push(node);
  }
  return out;
}

/** Whether nothing holds the step back: no date ahead, no step before it, no block. */
function ready(node: StepNode): boolean {
  return node.status === 'open' && !node.waitsUntil && (node.waitingOn?.length ?? 0) === 0;
}

/** What a step that cannot start yet waits on, in a few words. */
function waitsOn(node: StepNode): string | null {
  if (node.waitsUntil) return `From ${formatDay(node.waitsUntil)}`;
  const first = node.waitingOn?.[0];
  if (first) return `After “${first.title}”`;
  if (node.status === 'blocked')
    return node.blockAsk?.trim() ? `Needs ${lowerFirst(node.blockAsk.trim())}` : 'Blocked';
  return null;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function whose(node: StepNode): string | null {
  const parts = [
    node.kind === 'claude' ? 'Dash’s' : null,
    node.dueOn ? `by ${formatDay(node.dueOn)}` : null,
  ];
  const said = parts.filter(Boolean).join(' · ');
  return said ? said.charAt(0).toUpperCase() + said.slice(1) : null;
}

function card(node: StepNode, line: string | null): StripCard {
  return { id: node.id, title: node.title, line, href: stepAnchor(node.id) };
}

export function goalStrip(steps: readonly StepNode[], yourMove: readonly StatusRow[]): GoalStrip {
  const first = yourMove[0];
  const now: StripCard | null = first
    ? {
        id: first.id,
        title: first.title,
        line: first.label,
        href: first.href,
        canClose: first.kind === 'do',
      }
    : null;
  const leaves = openLeaves(steps).filter((node) => node.id !== now?.id);
  const nextNode = leaves.find(ready) ?? null;
  const rest = leaves.filter((node) => node !== nextNode);
  const laterNode = rest[0] ?? null;
  return {
    now,
    next: nextNode ? card(nextNode, whose(nextNode)) : null,
    later: laterNode ? card(laterNode, waitsOn(laterNode) ?? whose(laterNode)) : null,
    laterMore: Math.max(0, rest.length - 1),
  };
}
