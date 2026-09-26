'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ListFilter, ListTree } from 'lucide-react';
import { Progress, SectionTally } from '@/components/plan-tree/counts';
import { ColumnHeader } from '@/components/plan-tree/grid';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/cn';
import {
  GOAL_VIEWS,
  GOAL_VIEW_LABEL,
  countGoalView,
  goalCatalog,
  goalRows,
  numberSteps,
  viewGoalRows,
  type GoalView,
} from '@/lib/goals/plan-rows';
import { countAside, type StepRunView } from '@/lib/goals/shaping';
import type { GoalMap } from '@/lib/goals/steps-store';
import { GoalRow, type GoalRowContext } from './goal-row';
import { StepComposer } from './step-parts';
import type { InformationSeam } from './information-step';

/** How often the page looks again while a step's run is going, as the Claude panel does. */
const RUN_POLL_MS = 15_000;

const NO_RUNS: Record<string, StepRunView> = {};

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
};

/**
 * A goal's full tree (plan #925), drawn as the dev plan draws a module
 * (plan #982).
 *
 * One card: a heading with the plan's count of steps by state and its banded
 * bar, the column header, and a row per step from the plan's shared tree.
 * A goal whose top-level steps have steps of their own is drawn in stages
 * instead: the heading card with the count and bar, then a card per stage,
 * labelled Stage 1 of N, so a long map reads as its parts.
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
}: {
  map: GoalMap;
  todoOn: boolean;
  /** The latest run on each step sent or prepared from its row, by step id (plan #1044). */
  runs?: Record<string, StepRunView>;
  /** Start with every step's sub-steps showing. */
  unfolded?: boolean;
  /** Start with every step opened. A seam for the gallery; nothing in the app passes it. */
  opened?: boolean;
  /** An information step's list as the gallery wants it. Nothing in the app passes it. */
  informationSeam?: InformationSeam;
}) {
  const [showAside, setShowAside] = useState(false);
  const [view, setView] = useState<GoalView>('all');
  const aside = countAside(map.steps);
  // While a step's run is going, read the page again now and then, so its
  // row moves on to what the run is on now and then to how it ended.
  const router = useRouter();
  const anyRunning = Object.values(runs).some((run) => run.running !== null);
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(() => router.refresh(), RUN_POLL_MS);
    return () => clearInterval(timer);
  }, [anyRunning, router]);

  const { own, linked, context } = useMemo(() => {
    const numbers = numberSteps([map.steps, ...map.linked.map((entry) => [entry.step])]);
    const options = { numbers, threads: map.threads, showAside };
    const context: GoalRowContext = {
      goalTitle: map.goal.title,
      todoOn,
      rhythms: map.rhythms,
      information: map.information,
      answers: map.answers,
      linksOf: map.linksOf,
      otherGoals: map.otherGoals,
      catalog: goalCatalog(map.steps, numbers),
      unfolded,
      opened,
      informationSeam,
      runs,
    };
    return {
      own: goalRows(map.steps, options),
      linked: map.linked.map((entry) => ({
        entry,
        row: goalRows([entry.step], options).rows[0],
      })),
      context,
    };
  }, [map, todoOn, showAside, unfolded, opened, informationSeam, runs]);

  const substeps = own.rows.filter((row) => row.kind !== 'decision');
  // A goal whose top-level steps hold steps of their own is laid out in
  // stages: one card each, in order, so the path reads as its parts. Top-level
  // steps with nothing under them go in a last card of their own.
  const allStages = own.rows.filter((row) => row.children.length > 0);
  const staged = allStages.length >= 2;

  // The view narrows the rows, not the layout: a goal drawn in stages stays in
  // stages, and each stage keeps its number, so "Stage 3 of 4" means the same
  // under every view. A stage with nothing in the view is left out.
  const shown = viewGoalRows(own.rows, view);
  const shownById = new Map(shown.map((row) => [row.id, row]));
  const stages = allStages.map((row) => shownById.get(row.id) ?? null);
  const loose = own.rows
    .filter((row) => row.children.length === 0)
    .flatMap((row) => shownById.get(row.id) ?? []);
  const shownLinked = linked.flatMap(({ entry, row }) => {
    const narrowed = row ? viewGoalRows([row], view)[0] : undefined;
    return narrowed ? [{ entry, row: narrowed }] : [];
  });
  // The first card drawn carries the column header, whichever stage that is.
  const firstStage = stages.findIndex(Boolean);
  const firstCard = firstStage === -1 ? stages.length : firstStage;
  const emptyView = view !== 'all' && shown.length === 0 ? EMPTY_VIEW[view] : null;
  const counts = [...own.rows, ...linked.flatMap(({ row }) => (row ? [row] : []))];

  return (
    <div className="space-y-6">
      <section aria-label="Steps" className="space-y-2">
        {map.steps.length === 0 ? (
          <EmptyState
            icon={ListTree}
            title="No steps yet"
            description="Break the goal into the things that have to happen. Any step can hold sub-steps of its own."
          />
        ) : (
          <div className={cn(cardVariants({ padding: 'none' }), 'overflow-hidden')}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
              <h2 className="text-body font-semibold text-ink">Steps</h2>
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
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
              <Segmented
                label="View"
                value={view}
                onChange={setView}
                options={GOAL_VIEWS.map((candidate) => {
                  const count = candidate === 'all' ? 0 : countGoalView(counts, candidate);
                  return {
                    value: candidate,
                    label:
                      count > 0
                        ? `${GOAL_VIEW_LABEL[candidate]} ${count}`
                        : GOAL_VIEW_LABEL[candidate],
                  };
                })}
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
            {!staged && shown.length > 0 && (
              <ul className="divide-y divide-border">
                <ColumnHeader priority="When" />
                {shown.map((row) => (
                  <GoalRow
                    key={row.id}
                    node={row}
                    trail={[]}
                    context={context}
                    index={substeps.findIndex((step) => step.id === row.id)}
                    count={substeps.length}
                  />
                ))}
              </ul>
            )}
            {/* Inside the card, under a rule, as the plan's "Add a step" sits
                at the foot of a module (plan #983), on the same py-1.5 line as
                every other add line on the page. */}
            {!staged && (
              <div className="border-t border-border px-3 py-1.5">
                <StepComposer parentId={map.goal.id} label="Add a step" bare />
              </div>
            )}
          </div>
        )}
        {staged &&
          [...stages, ...(loose.length > 0 ? [null] : [])].map((stage, i) => {
            if (i < stages.length && !stage) return null;
            return (
              <div key={stage?.id ?? 'loose'} className="space-y-1">
                <h3 className="px-1 text-small font-semibold text-ink-muted">
                  {stage ? `Stage ${i + 1} of ${stages.length}` : 'Other steps'}
                </h3>
                <div className={cn(cardVariants({ padding: 'none' }), 'overflow-hidden')}>
                  <ul className="divide-y divide-border">
                    {i === firstCard && <ColumnHeader priority="When" />}
                    {(stage ? [stage] : loose).map((row) => (
                      <GoalRow
                        key={row.id}
                        node={row}
                        trail={[]}
                        context={context}
                        index={substeps.findIndex((step) => step.id === row.id)}
                        count={substeps.length}
                      />
                    ))}
                  </ul>
                  {!stage && (
                    <div className="border-t border-border px-3 py-1.5">
                      <StepComposer parentId={map.goal.id} label="Add a step" bare />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        {staged && !own.rows.some((row) => row.children.length === 0) && (
          <div className="px-1">
            <StepComposer parentId={map.goal.id} label="Add a stage or a step" />
          </div>
        )}
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
        {map.steps.length === 0 && <StepComposer parentId={map.goal.id} label="Add a step" />}
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
