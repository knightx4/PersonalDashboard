'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ListTree } from 'lucide-react';
import { TabbedDetail } from '@/components/patterns/tabbed-detail';
import type { TreeRowFrameParts } from '@/components/plan-tree/tree-row';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import type { LinkedFile } from '@/lib/files/files';
import type { GoalRunRow } from '@/lib/goals/runs';
import { isClosed, isDismissed } from '@/lib/plan/load';
import { stepCrumbs } from '@/lib/goals/crumbs';
import { STEP_TABS, type StepTab } from '@/lib/goals/goal-page';
import { tabSearch } from '@/lib/tabs';
import type { GoalRowNode } from '@/lib/goals/plan-rows';
import type { ItemProgress } from '@/lib/goals/progress';
import type { StepRunView } from '@/lib/goals/shaping';
import type { GoalMap } from '@/lib/goals/steps-store';
import { GoalRow } from './goal-row';
import type { InformationSeam } from './information-step';
import { RunHistory } from './goal-shaping';
import { StepComposer } from './step-parts';
import { openSubsteps, stepFactParts, stepLine } from './step-properties';
import { GoalColumnHeader, useGoalRows } from './step-tree';

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
 * hands its status, title and menu to the frame (`frame` on TreeRow), and
 * the rest of itself in parts that the open tab draws (plan #2373.2).
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
  tab = 'overview',
  history,
}: {
  map: GoalMap;
  stepId: string;
  /** The open tab, which the route reads from `?tab=` (plan #2373.2). */
  tab?: StepTab;
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
  /**
   * The step's latest runs for its Activity tab, as the goal's are listed on
   * its own (plan #2373.3), and whether older ones are on the Runs page.
   */
  history?: { runs: GoalRunRow[]; more: boolean };
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

  // The open sub-steps the tab lists as rows: the step's own, not every
  // level beneath, as the properties count them (plan #2373.2).
  const open = openSubsteps(row);
  // Counted as the questions' own label counts them, which the page's heading replaces.
  const unanswered = row.children.filter(
    (child) => child.kind === 'decision' && !isClosed(child.status) && !isDismissed(child),
  ).length;
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
      frame={({ status, statusPicker, title, menu, ...parts }) => {
        const facts = stepFactParts(row, statusPicker);
        return (
          <TabbedDetail
            // The path down to the step, through every step it sits under (plan #1622).
            subject={{ ref: null, path: crumbs ?? [] }}
            // The status you press, then the title, as the goal's hexagon and title.
            lead={status}
            title={title}
            description={<span className="text-small">{stepLine(row, timeZone)}</span>}
            actions={menu}
            glance={facts.glance}
            detailCount={facts.detailCount}
            properties={facts.properties}
            tabs={tabs}
            label="Step"
            className="gap-y-2 lg:grid-rows-[auto_1fr] lg:gap-y-0"
          >
            <OpenTab
              tab={tab}
              parts={parts}
              stepId={row.id}
              unanswered={unanswered}
              hasQuestions={row.children.some((child) => child.kind === 'decision')}
              hasEdges={row.dependsOn.length + row.waitingOn.length + row.blocks.length > 0}
              history={history}
              hasSubsteps={row.children.some((child) => child.kind !== 'decision')}
            />
          </TabbedDetail>
        );
      }}
    />
  );
}

/**
 * The open tab of a step's page (plan #2373.2), from the parts its row hands
 * the frame. Overview is the panel: the detail and done-when you edit, the
 * facts, what it waits on, its questions, Dash's draft and its files.
 * Sub-steps is the open sub-steps on the goal page's columns with the
 * finished ones folded at the foot, then the composer, or an empty state
 * that adds the first. Activity is the step's latest run and its thread.
 *
 * Add a sub-step in the menu opens the composer on the Sub-steps tab, moving
 * there from another tab first.
 */
function OpenTab({
  tab,
  parts,
  stepId,
  hasSubsteps,
  unanswered,
  hasQuestions,
  hasEdges,
  history,
}: {
  tab: StepTab;
  parts: Omit<TreeRowFrameParts, 'status' | 'statusPicker' | 'title' | 'menu'>;
  stepId: string;
  hasSubsteps: boolean;
  /** How many of the step's questions wait on an answer, said beside their heading. */
  unanswered: number;
  /** Whether the step has questions, which then get a part of their own. */
  hasQuestions: boolean;
  /** Whether the step waits on a step or one waits on it, which then get a part of their own. */
  hasEdges: boolean;
  history?: { runs: GoalRunRow[]; more: boolean };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { adding, stopAdding } = parts;
  useEffect(() => {
    if (adding && tab !== 'substeps') {
      router.push(`${pathname}${tabSearch('', 'substeps', STEP_TABS)}`, { scroll: false });
    }
  }, [adding, tab, router, pathname]);

  if (tab === 'activity') {
    return (
      <div className="space-y-6">
        {/* The step's runs as the goal's Activity tab lists its own: each
            run's name, how it ended, when and how long it took, then what it
            did (plan #2373.3). The gallery, with no history, draws the
            latest run's line from the row. */}
        <section aria-label="Runs">
          <Card padding="dense">
            {history && history.runs.length > 0 ? (
              <RunHistory runs={history.runs} more={history.more} />
            ) : parts.activity ? (
              <ul>{parts.activity}</ul>
            ) : (
              <p className="text-small text-ink-muted">Dash has not run on this step yet.</p>
            )}
          </Card>
        </section>
        {/* The step's own thread, on the card's ground, as the goal's is on its Activity tab. */}
        <Card padding="dense">{parts.thread}</Card>
      </div>
    );
  }

  if (tab === 'substeps') {
    // Keyed by `adding`, so pressing Add a sub-step in the menu opens a
    // composer that was standing closed.
    const composer = (bare: boolean) => (
      <StepComposer
        key={adding ? 'adding' : 'closed'}
        parentId={stepId}
        label="Add a sub-step"
        bare={bare}
        startOpen={adding}
        onClose={stopAdding}
      />
    );
    if (!hasSubsteps) {
      return (
        <section aria-label="Sub-steps" className="space-y-2">
          {!adding && (
            <EmptyState
              icon={ListTree}
              title="No sub-steps yet"
              description="Break this step into smaller ones when it is more than one sitting of work."
            />
          )}
          {composer(false)}
        </section>
      );
    }
    return (
      <Card padding="none">
        <ul className="divide-y divide-border">
          <GoalColumnHeader />
          {parts.substeps}
        </ul>
        {/* At the foot of the card under a rule, as Add a step sits on a goal's Steps. */}
        <div className="border-t border-border px-3 py-1.5">{composer(true)}</div>
      </Card>
    );
  }

  // The panel on its card, then the questions and what the step waits on,
  // each under a heading on the page and on a card of its own, as the goal's
  // Overview lays out its parts (plan #2373.3). With none of either, only
  // the line that adds the first is left, and it closes the panel's card
  // instead, so closing the step does not take whole parts off the page.
  return (
    <div className="space-y-6">
      <Card padding="none">
        <ul className="pt-2">{parts.overview}</ul>
        {(!hasQuestions || !hasEdges) && (
          <div className="space-y-2 px-3 pb-3 empty:hidden">
            {!hasQuestions && parts.questions}
            {!hasEdges && parts.dependencies}
          </div>
        )}
      </Card>
      {hasQuestions && (
        <OverviewPart
          id="step-questions"
          title="Questions"
          count={
            unanswered > 0 ? <span className="text-caution">{unanswered} unanswered</span> : null
          }
        >
          {parts.questions}
        </OverviewPart>
      )}
      {hasEdges && parts.dependencies && (
        <OverviewPart id="step-dependencies" title="Dependencies">
          {parts.dependencies}
        </OverviewPart>
      )}
    </div>
  );
}

/**
 * One part of a step's Overview under its own heading, as Waiting on you is on
 * a goal's: the heading on the page with its count, the part on a card. Hidden
 * whole when the part draws nothing.
 */
function OverviewPart({
  id,
  title,
  count,
  children,
}: {
  id: string;
  title: string;
  count?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-2 has-[[data-part]:empty]:hidden">
      <h2 id={id} className="flex items-baseline gap-2 px-1 text-ui font-semibold text-ink">
        {title}
        {count && <span className="tabular text-small font-normal text-ink-muted">{count}</span>}
      </h2>
      <Card padding="dense">
        <div data-part>{children}</div>
      </Card>
    </section>
  );
}
