'use client';

import type { LinkedFile } from '@/lib/files/files';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ListFilter, ListTree } from 'lucide-react';
import { Progress, SectionTally } from '@/components/plan-tree/counts';
import { ColumnHeader } from '@/components/plan-tree/grid';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
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
  outlineSteps,
  viewGoalRows,
  type GoalRowNode,
  type GoalView,
} from '@/lib/goals/plan-rows';
import { goalStages, stageMeta } from '@/lib/goals/goal-page';
import { countAside, type StepRunView } from '@/lib/goals/shaping';
import type { GoalMap } from '@/lib/goals/steps-store';
import { GoalRow, type GoalRowContext } from './goal-row';
import { StepComposer } from './step-parts';
import type { InformationSeam } from './information-step';

/** How often the page looks again while a step's run is going, as the Claude panel does. */
const RUN_POLL_MS = 15_000;

const NO_RUNS: Record<string, StepRunView> = {};
const NO_FILES: Record<string, LinkedFile[]> = {};

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
};

/**
 * A goal's full tree (plan #925), drawn as the dev plan draws a module
 * (plan #982).
 *
 * One card: a heading with the plan's count of steps by state and its banded
 * bar, the column header, and a row per step from the plan's shared tree.
 * Finished steps fold away under the open ones. A goal whose top-level steps
 * have steps of their own is drawn in stages instead (plan #1078): the first
 * unfinished stage open under "Stage 1 of N", and every other stage folded to
 * one line saying whether it is done or how far along, so the page opens on
 * the work in hand.
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
}: {
  map: GoalMap;
  todoOn: boolean;
  /** The latest run on each step sent or prepared from its row, by step id (plan #1044). */
  runs?: Record<string, StepRunView>;
  /** The files each step links to, by step id. */
  files?: Record<string, LinkedFile[]>;
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
    };
    return {
      own: goalRows(map.steps, options),
      linked: map.linked.map((entry) => ({
        entry,
        row: goalRows([entry.step], options).rows[0],
      })),
      context,
    };
  }, [map, todoOn, showAside, unfolded, opened, informationSeam, runs, files]);

  const substeps = own.rows.filter((row) => row.kind !== 'decision');
  // A goal whose top-level steps hold steps of their own is laid out in
  // stages (plan #1078): every stage under way open, since stages can run
  // alongside each other, and the others folded to one line each that says
  // how far along it is or which stage holds it. Top-level steps with
  // nothing under them go in a last card of their own.
  const allStages = own.rows.filter((row) => row.children.length > 0);
  const stageOf = new Map((goalStages(map.steps) ?? []).map((stage) => [stage.id, stage]));
  const staged = allStages.length >= 2;

  // The view narrows the rows of a goal that is one list. A goal in stages
  // has its folds in place of a view, so it shows every row.
  const shown = viewGoalRows(own.rows, staged ? 'all' : view);
  // Finished steps fold away under the open ones.
  const shownOpen = shown.filter((row) => !isClosed(row));
  const shownDone = shown.filter(isClosed);
  const loose = own.rows.filter((row) => row.children.length === 0);
  const current = allStages.filter((row) => stageOf.get(row.id)?.state === 'current');
  const folded = allStages.filter((row) => !current.includes(row));
  const shownLinked = linked.flatMap(({ entry, row }) => {
    const narrowed = row ? viewGoalRows([row], staged ? 'all' : view)[0] : undefined;
    return narrowed ? [{ entry, row: narrowed }] : [];
  });
  const emptyView = !staged && view !== 'all' && shown.length === 0 ? EMPTY_VIEW[view] : null;
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
  const stageCard = (row: GoalRowNode, header: boolean) => (
    <div className={cn(cardVariants({ padding: 'none' }), 'overflow-hidden')}>
      <ul className="divide-y divide-border">
        {header && <ColumnHeader priority="When" />}
        {rowOf(row)}
      </ul>
    </div>
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
        {map.steps.length > 0 && !staged && (
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
            {shownOpen.length > 0 && (
              <ul className="divide-y divide-border">
                <ColumnHeader priority="When" />
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
        {staged &&
          current.map((row, i) => {
            const stage = stageOf.get(row.id);
            return (
              <div key={row.id} className={cn('space-y-2', i > 0 && 'pt-2')}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-1">
                  <h2 className="text-body font-semibold text-ink">
                    Stage {allStages.indexOf(row) + 1} of {allStages.length}
                  </h2>
                  {stage && (
                    <span className="tabular text-small text-ink-muted">{stageMeta(stage)}</span>
                  )}
                </div>
                {stageCard(row, i === 0)}
              </div>
            );
          })}
        {staged && current.length === 0 && (
          <p className="px-1 text-ui text-ink-muted">Every stage is done.</p>
        )}
        {staged && folded.length > 0 && (
          <div className="space-y-1 pt-2">
            <h2 className="px-1 text-small font-semibold text-ink-muted">
              {current.length > 0 ? 'Other stages' : 'Stages'}
            </h2>
            {folded.map((row) => {
              const stage = stageOf.get(row.id);
              return (
                <Disclosure
                  key={row.id}
                  className="px-1"
                  title={`${allStages.indexOf(row) + 1}. ${row.title}`}
                  meta={stage ? stageMeta(stage) : undefined}
                >
                  {stageCard(row, false)}
                </Disclosure>
              );
            })}
          </div>
        )}
        {staged && loose.length > 0 && (
          <div className="space-y-1 pt-2">
            <h2 className="px-1 text-small font-semibold text-ink-muted">Other steps</h2>
            <div className={cn(cardVariants({ padding: 'none' }), 'overflow-hidden')}>
              <ul className="divide-y divide-border">
                {current.length === 0 && <ColumnHeader priority="When" />}
                {loose.filter((row) => !isClosed(row)).map(rowOf)}
              </ul>
              {loose.some(isClosed) && (
                <div className="border-t border-border px-3 py-1.5">
                  <Disclosure title="Finished" meta={loose.filter(isClosed).length}>
                    <ul className="divide-y divide-border">{loose.filter(isClosed).map(rowOf)}</ul>
                  </Disclosure>
                </div>
              )}
              <div className="border-t border-border px-3 py-1.5">
                <StepComposer parentId={map.goal.id} label="Add a step" bare />
              </div>
            </div>
          </div>
        )}
        {staged && loose.length === 0 && (
          <div className="px-1">
            <StepComposer parentId={map.goal.id} label="Add a stage or a step" />
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
