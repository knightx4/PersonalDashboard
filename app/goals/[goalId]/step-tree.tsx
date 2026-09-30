'use client';

import type { LinkedFile } from '@/lib/files/files';
import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ListFilter, ListTree } from 'lucide-react';
import { Progress, SectionTally } from '@/components/plan-tree/counts';
import { ColumnHeader } from '@/components/plan-tree/grid';
import { ViewChips } from '@/components/plan-tree/view-chips';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/cn';
import {
  DEFAULT_GOAL_VIEW,
  GOAL_VIEWS,
  GOAL_VIEW_CHIPS,
  GOAL_VIEW_LABEL,
  GOAL_VIEW_MENU,
  countGoalView,
  goalCatalog,
  goalRows,
  goalViewHref,
  numberSteps,
  outlineSteps,
  viewGoalRows,
  type GoalRowNode,
  type GoalView,
} from '@/lib/goals/plan-rows';
import { stepPreps } from '@/lib/goals/goal-page';
import { lastProgressOn, latestBeneath, type ItemProgress } from '@/lib/goals/progress';
import { formatDay } from '@/lib/goals/dates';
import { countAside, type StepRunView } from '@/lib/goals/shaping';
import type { GoalMap } from '@/lib/goals/steps-store';
import { GoalRow, type GoalRowContext } from './goal-row';
import { StepComposer } from './step-parts';
import type { InformationSeam } from './information-step';

/** How often the page looks again while a step's run is going, as the Claude panel does. */
const RUN_POLL_MS = 15_000;

const NO_RUNS: Record<string, StepRunView> = {};
const NO_FILES: Record<string, LinkedFile[]> = {};
const NO_PROGRESS: Record<string, ItemProgress> = {};

/** A step that is finished or dropped, which folds away under the open ones. */
function isClosed(row: GoalRowNode): boolean {
  return row.step.status === 'done' || row.step.status === 'dropped';
}

/** What a narrowed view says when nothing is in it. */
const EMPTY_VIEW: Record<Exclude<GoalView, 'all'>, { title: string; description: string }> = {
  open: {
    title: 'Nothing open',
    description: 'Every step on this goal is done or dropped.',
  },
  you: {
    title: 'Nothing waiting on you',
    description:
      'No question to answer, nothing blocked on you and nothing of yours ready to do. The goal can move without you.',
  },
  ready: {
    title: 'Nothing ready for Dash',
    description:
      'Every open step is waiting on you or on another step. Settle one and the next becomes ready.',
  },
  read: {
    title: 'Nothing to read',
    description: 'You have read everything Dash has found for this goal.',
  },
};

/**
 * A goal's full tree (plan #925), drawn as the dev plan draws a module
 * (plan #982).
 *
 * One card: a heading with the plan's count of steps by state and its banded
 * bar, the column header, and a row per step from the plan's shared tree.
 * Finished steps fold away under the open ones. A goal whose top-level steps
 * have steps of their own was drawn a card per stage (plan #1078); it is one
 * card like any other now (note 014bae50), each stage a row that opens, and
 * the view above it, set to Open, is what used to fold the other stages away
 * (note 9e8cd196).
 * Steps from other goals that count towards this one follow in a second card,
 * which has no column header of its own since its columns line up with the
 * first, and each row names the goal it comes from under its title.
 */
export function StepTree({
  map,
  todoOn,
  unfolded = true,
  opened = false,
  informationSeam,
  runs = NO_RUNS,
  files = NO_FILES,
  progress = NO_PROGRESS,
  view = DEFAULT_GOAL_VIEW,
}: {
  map: GoalMap;
  /**
   * Which of the views to show: the page's `?view=` (plan #1157), so the
   * choice is in the address and survives a reload. Open when none is named.
   */
  view?: GoalView;
  todoOn: boolean;
  /** The latest run on each step sent or prepared from its row, by step id (plan #1044). */
  runs?: Record<string, StepRunView>;
  /** The files each step links to, by step id. */
  files?: Record<string, LinkedFile[]>;
  /**
   * The progress logged on the goal and each step, by item id (plan #1276).
   * A step with none is not in it and reads as it always has.
   */
  progress?: Record<string, ItemProgress>;
  /** Start with every step's sub-steps showing. */
  unfolded?: boolean;
  /** Start with every step opened. A seam for the gallery; nothing in the app passes it. */
  opened?: boolean;
  /** An information step's list as the gallery wants it. Nothing in the app passes it. */
  informationSeam?: InformationSeam;
}) {
  const [showAside, setShowAside] = useState(false);
  const aside = countAside(map.steps);
  // While a step's run is going, read the page again now and then, so its
  // row moves on to what the run is on now and then to how it ended.
  const router = useRouter();
  const path = usePathname() ?? `/goals/${map.goal.id}`;
  const anyRunning = Object.values(runs).some((run) => run.running !== null);
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(() => router.refresh(), RUN_POLL_MS);
    return () => clearInterval(timer);
  }, [anyRunning, router]);

  const { own, linked, context } = useMemo(() => {
    const trees = [map.steps, ...map.linked.map((entry) => [entry.step])];
    const numbers = numberSteps(trees);
    const outlines = outlineSteps(trees);
    const options = { numbers, outlines, threads: map.threads, showAside };
    const context: GoalRowContext = {
      goalTitle: map.goal.title,
      todoOn,
      rhythms: map.rhythms,
      information: map.information,
      answers: map.answers,
      linksOf: map.linksOf,
      otherGoals: map.otherGoals,
      catalog: goalCatalog(map.steps, numbers, outlines),
      unfolded,
      opened,
      informationSeam,
      runs,
      files,
      progress,
      progressBeneath: latestBeneath(trees.flat(), progress),
      ...stepPreps(trees),
    };
    return {
      own: goalRows(map.steps, options),
      linked: map.linked.map((entry) => ({
        entry,
        row: goalRows([entry.step], options).rows[0],
      })),
      context,
    };
  }, [map, todoOn, showAside, unfolded, opened, informationSeam, runs, files, progress]);
  // When anything on the goal last moved, its own entries included.
  const lastOn = lastProgressOn(progress);

  const substeps = own.rows.filter((row) => row.kind !== 'decision');

  const shown = viewGoalRows(own.rows, view);
  // Finished steps fold away under the open ones, except under To read,
  // where nearly every row is a finished Dash step (note 704c8e3a).
  const folds = view !== 'read';
  const shownOpen = folds ? shown.filter((row) => !isClosed(row)) : shown;
  const shownDone = folds ? shown.filter(isClosed) : [];
  const shownLinked = linked.flatMap(({ entry, row }) => {
    const narrowed = row ? viewGoalRows([row], view)[0] : undefined;
    return narrowed ? [{ entry, row: narrowed }] : [];
  });
  const emptyView = view !== 'all' && shown.length === 0 ? EMPTY_VIEW[view] : null;
  const counts = [...own.rows, ...linked.flatMap(({ row }) => (row ? [row] : []))];
  const rowOf = (row: GoalRowNode) => (
    <GoalRow
      key={row.id}
      node={row}
      trail={[]}
      context={context}
      index={substeps.findIndex((step) => step.id === row.id)}
      count={substeps.length}
    />
  );

  return (
    <div className="space-y-6">
      <section aria-label="Steps" className="space-y-2">
        {map.steps.length === 0 && (
          <EmptyState
            icon={ListTree}
            title="No steps yet"
            description="Break the goal into the things that have to happen. Any step can hold sub-steps of its own."
          />
        )}
        {map.steps.length > 0 && (
          <div className={cn(cardVariants({ padding: 'none' }), 'overflow-hidden')}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
              <h2 className="text-body font-semibold text-ink">Steps</h2>
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {lastOn && (
                  <span className="tabular text-small text-ink-muted">
                    Last progress {formatDay(lastOn)}
                  </span>
                )}
                <SectionTally tally={own.tally} label={map.goal.title} />
                <Progress label={map.goal.title} progress={own.progress} bands={own.bands} />
              </span>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto border-b border-border px-3 py-2">
              <ListFilter
                className="size-3.5 shrink-0 text-ink-muted"
                strokeWidth={1.75}
                aria-hidden
              />
              <ViewChips
                view={view}
                chips={GOAL_VIEW_CHIPS}
                menu={GOAL_VIEW_MENU}
                labels={GOAL_VIEW_LABEL}
                hrefOf={(candidate) => goalViewHref(path, candidate)}
                counts={Object.fromEntries(
                  GOAL_VIEWS.filter((candidate) => candidate !== 'all').map((candidate) => [
                    candidate,
                    countGoalView(counts, candidate),
                  ]),
                )}
                scroll={false}
              />
            </div>
            {emptyView && (
              <div className="p-3">
                <EmptyState
                  icon={ListTree}
                  title={emptyView.title}
                  description={emptyView.description}
                />
              </div>
            )}
            {shownOpen.length > 0 && (
              <ul className="divide-y divide-border">
                <ColumnHeader status="Who" priority="When" />
                {shownOpen.map(rowOf)}
              </ul>
            )}
            {shownDone.length > 0 && (
              <div className="border-t border-border px-3 py-1.5">
                <Disclosure title="Finished" meta={shownDone.length}>
                  <ul className="divide-y divide-border">{shownDone.map(rowOf)}</ul>
                </Disclosure>
              </div>
            )}
            {/* Inside the card, under a rule, as the plan's "Add a step" sits
                at the foot of a module (plan #983), on the same py-1.5 line as
                every other add line on the page. */}
            <div className="border-t border-border px-3 py-1.5">
              <StepComposer parentId={map.goal.id} label="Add a step" bare />
            </div>
          </div>
        )}
        {map.steps.length === 0 && <StepComposer parentId={map.goal.id} label="Add a step" />}
        {aside > 0 && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-pressed={showAside}
            onClick={() => setShowAside(!showAside)}
          >
            {showAside
              ? 'Hide the questions put aside'
              : `Show ${aside === 1 ? 'the question' : `the ${aside} questions`} put aside`}
          </Button>
        )}
      </section>

      {shownLinked.length > 0 && (
        <section
          aria-labelledby="linked-heading"
          className={cn(cardVariants({ padding: 'none' }), 'overflow-hidden')}
        >
          <h2
            id="linked-heading"
            className="border-b border-border px-3 py-2.5 text-body font-semibold text-ink"
          >
            Also counts towards this goal
          </h2>
          <ul className="divide-y divide-border">
            {shownLinked.map(({ entry, row }) => (
              <GoalRow
                key={entry.linkId}
                node={row}
                trail={[]}
                context={context}
                index={0}
                count={1}
                unlinkId={entry.linkId}
                fromGoal={entry.fromGoal}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
