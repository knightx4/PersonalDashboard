import 'server-only';

import { refHref } from '@/lib/core/refs';
import { loadPlan, type PlanData } from '@/lib/plan/load';
import { buildPlanTree, flattenSections } from '@/lib/plan/tree';
import { waitingOnYou, type WaitingRow } from '@/lib/plan/waiting';
import { sessionClients } from '@/lib/todo/agenda/clients';
import { dismiss } from '@/lib/todo/agenda/dismissals';
import { SNOOZE_DAYS } from '@/lib/todo/tasks/model';
import type { AgendaItem, AgendaSource, SourceContext } from '@/lib/todo/agenda/sources';

/**
 * Plan rows whose move is on you, from public.plan_items (plan #1473): a
 * question to answer, a proposal to approve, a step stopped on something only
 * you can give it, and a setup job of yours. The rows are the ones the Dash
 * tab's "Waiting on you" lists (`waitingOnYou` in lib/plan/waiting.ts), read
 * by the same rule, so the two never disagree; a row leaves here the moment
 * that rule says the move is no longer yours.
 *
 * A proposed feature is one item, not one per proposed step under it:
 * approving the feature approves what is beneath it, so the steps are counted
 * in its detail instead of listed.
 *
 * Always on, like applications: Part 4 of docs/CORE-AND-DASH-SPEC.md puts
 * everything whose move is yours on this list. Not completable, since what
 * ends the move (an answer, an approval, a key set) is done on the plan.
 * "Later" and "Not this one" go in the dismissal overlay, keyed by the row
 * and what it is waiting on you for, so a step blocked again after a
 * dismissal shows again.
 */

const PREFIX = 'plan_steps:';

const TITLE: Record<WaitingRow['health'], (row: WaitingRow) => string> = {
  unanswered: (row) => row.title,
  proposed: (row) => `Approve #${row.number}: ${row.title}`,
  blocked: (row) => row.title,
  setup: (row) => row.title,
};

function detailOf(row: WaitingRow): string | null {
  if (row.health === 'proposed') {
    return row.proposedBeneath > 0
      ? `Proposed, with ${row.proposedBeneath} ${row.proposedBeneath === 1 ? 'step' : 'steps'} under it`
      : 'Proposed';
  }
  if (row.health === 'blocked') return row.ask ? `Needs: ${firstLine(row.ask)}` : 'Stopped on you';
  if (row.health === 'setup') return 'Yours to set up';
  return 'Waiting on your answer';
}

function firstLine(text: string): string {
  return text.trim().split(/\r?\n/)[0].trim();
}

/** Pure: the agenda items for the plan rows on you. Exported for tests. */
export function planStepItems(data: PlanData): AgendaItem[] {
  const sections = buildPlanTree(data);
  const nodes = new Map(flattenSections(sections).map((node) => [node.id, node]));

  return waitingOnYou(sections)
    .filter((row) => {
      if (row.health !== 'proposed') return true;
      // Under a proposal of its own, the step is approved with it.
      const parentId = nodes.get(row.id)?.parentId;
      return !(parentId && nodes.get(parentId)?.status === 'proposed');
    })
    .map((row) => {
      const node = nodes.get(row.id);
      const ref = `public.plan_items:${row.id}`;
      return {
        key: `${PREFIX}${row.id}:${row.health}`,
        source: 'plan_steps',
        ref,
        title: TITLE[row.health](row),
        day: null,
        // A block is on you from when it was written, which is the row's last
        // change; the rest from when the row was.
        onYouSince: (row.health === 'blocked' ? node?.updatedAt : node?.createdAt) || null,
        at: null,
        link: { href: refHref(ref) ?? '/dev/plan', label: `Plan #${row.number}` },
        action: null,
        detail: detailOf(row),
        completable: false,
      } satisfies AgendaItem;
    });
}

export const planStepsSource: AgendaSource = {
  id: 'plan_steps',
  label: 'Plan steps on you',
  module: 'dev',
  alwaysOn: true,
  description: 'Plan questions to answer, proposals to approve, and steps stopped on you.',

  async fetch(ctx: SourceContext): Promise<AgendaItem[]> {
    const supabase = await (ctx.clients ?? sessionClients).shopping();
    return planStepItems(await loadPlan(supabase, ctx.userId));
  },

  async defer(ctx, key) {
    const until = new Date(ctx.now);
    until.setUTCDate(until.getUTCDate() + SNOOZE_DAYS);
    await dismiss(ctx.userId, 'plan_item', key, until);
  },

  async dismiss(ctx, key) {
    await dismiss(ctx.userId, 'plan_item', key, null);
  },
};
