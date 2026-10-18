'use client';

import { TabbedDetail } from '@/components/patterns/tabbed-detail';
import { Card } from '@/components/ui/card';
import type { LinkedFile } from '@/lib/files/files';
import { stepCrumbs } from '@/lib/goals/crumbs';
import { STEP_TABS } from '@/lib/goals/goal-page';
import type { GoalRowNode } from '@/lib/goals/plan-rows';
import type { ItemProgress } from '@/lib/goals/progress';
import type { StepRunView } from '@/lib/goals/shaping';
import type { GoalMap } from '@/lib/goals/steps-store';
import { GoalRow } from './goal-row';
import type { InformationSeam } from './information-step';
import { StepGlance, StepProperties, stepDetailCount, stepLine } from './step-properties';
import { useGoalRows } from './step-tree';

/** The row for a step anywhere in the tree, with the rows beside it. */
function findRow(
  rows: readonly GoalRowNode[],
  id: string,
): { row: GoalRowNode; siblings: readonly GoalRowNode[] } | null {
  for (const row of rows) {
    if (row.id === id) return { row, siblings: rows };
    const found = findRow(row.children, id);
    if (found) return found;
  }
  return null;
}

/**
 * One step on a page of its own (plan #1620), at /goals/<goal>/s/<step>.
 *
 * The step is its row from the goal page, opened: the status you press to
 * change, the menu, the detail and done-when you edit in place, what it
 * waits on, Dash's draft, its files and its thread, and its sub-steps
 * beneath with the finished ones folded. So everything the row does on the
 * goal page it does here, through the same code. A sub-step opens the same
 * way. Above the row, the path from Goals names the area, the goal and every
 * step this one sits under (plan #1622).
 *
 * It sits in the goal page's frame (plan #2373.1): the path, the step's
 * status you press and its title, the menu on the title's line, the
 * Overview, Sub-steps and Activity tabs and the properties column. The row
 * hands its status, title and menu to the frame (`frame` on TreeRow) and
 * draws the rest of itself under the tabs.
 *
 * The page's caller has already checked the step is under this goal; a step
 * the rows do not hold draws nothing.
 */
export function StepPage({
  map,
  stepId,
  todoOn,
  runs,
  files,
  progress,
  arrivals,
  canRun = true,
  informationSeam,
  timeZone = 'UTC',
}: {
  map: GoalMap;
  stepId: string;
  todoOn: boolean;
  runs?: Record<string, StepRunView>;
  files?: Record<string, LinkedFile[]>;
  progress?: Record<string, ItemProgress>;
  arrivals?: readonly string[];
  canRun?: boolean;
  /** An information step's list as the gallery wants it. Nothing in the app passes it. */
  informationSeam?: InformationSeam;
  /** The account's zone, for the day the step was added. */
  timeZone?: string;
}) {
  const { own, context } = useGoalRows(map, {
    todoOn,
    unfolded: true,
    informationSeam,
    runs,
    files,
    progress,
    arrivals,
    canRun,
  });
  const found = findRow(own.rows, stepId);
  if (!found) return null;
  const { row, siblings } = found;
  const crumbs = stepCrumbs(map.goal, map.areaName, map.steps, stepId, {
    open: map.goal.status !== 'done' && map.goal.status !== 'dropped',
  });
  const substeps = siblings.filter((sibling) => sibling.kind !== 'decision');

  const open = row.rollup.live - row.rollup.done;
  const tabs = STEP_TABS.map((tab) =>
    tab.id === 'substeps'
      ? { ...tab, count: open }
      : tab.id === 'activity'
        ? { ...tab, count: row.thread.length }
        : tab,
  );

  return (
    <GoalRow
      node={row}
      trail={[]}
      context={context}
      index={substeps.findIndex((sibling) => sibling.id === row.id)}
      count={substeps.length}
      page
      frame={({ status, title, menu, rows }) => (
        <TabbedDetail
          // The path down to the step, through every step it sits under (plan #1622).
          subject={{ ref: null, path: crumbs ?? [] }}
          // The status you press, then the title, as the goal's hexagon and title.
          lead={status}
          title={title}
          description={<span className="text-small">{stepLine(row, timeZone)}</span>}
          actions={menu}
          glance={<StepGlance node={row} />}
          detailCount={stepDetailCount(row)}
          properties={<StepProperties node={row} />}
          tabs={tabs}
          label="Step"
          className="gap-y-2 lg:grid-rows-[auto_1fr] lg:gap-y-0"
        >
          {/* The step's panel and its sub-steps, whole until the next step
              (plan #2373.2) shares them out across the tabs. */}
          <Card padding="none">
            <ul className="pt-2">{rows}</ul>
          </Card>
        </TabbedDetail>
      )}
    />
  );
}
