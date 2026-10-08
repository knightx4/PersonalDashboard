'use client';

import type { LinkedFile } from '@/lib/files/files';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ListTree } from 'lucide-react';
import { ColumnHeader } from '@/components/plan-tree/grid';
import { StepGroupRows } from '@/components/plan-tree/step-group-rows';
import { ViewChips } from '@/components/plan-tree/view-chips';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import {
  goalCatalog,
  goalRows,
  numberSteps,
  outlineSteps,
  staysOpen,
  type GoalRowNode,
} from '@/lib/goals/plan-rows';
import { goalStages, stageMeta, stepPreps, type Stage } from '@/lib/goals/goal-page';
import {
  GOAL_STEPS_VIEWS,
  goalStepGroups,
  goalStepsViewHref,
  type GoalStepsView,
} from '@/lib/goals/step-groups';
import { latestBeneath, type ItemProgress } from '@/lib/goals/progress';
import { countAside, type StepRunView } from '@/lib/goals/shaping';
import type { GoalMap } from '@/lib/goals/steps-store';
import { FinishedFold, GoalRow, type GoalRowContext } from './goal-row';
import { StepComposer } from './step-parts';
import { StepFinder } from './step-finder';
import type { InformationSeam } from './information-step';

/** How often the page looks again while a step's run is going, as the Claude panel does. */
const RUN_POLL_MS = 15_000;

const NO_RUNS: Record<string, StepRunView> = {};
const NO_FILES: Record<string, LinkedFile[]> = {};
const NO_PROGRESS: Record<string, ItemProgress> = {};
const NO_ARRIVALS: readonly string[] = [];

const VIEW_LABEL: Record<GoalStepsView, string> = { status: 'By status', tree: 'Tree' };

/**
 * A goal's steps, laid out as a feature's Steps tab on /dev/plan is: view
 * chips, then one card of the plan's grid rows under a column header.
 *
 * **By status**, the default, lists every step and sub-step once in status
 * groups (lib/goals/step-groups.ts): Blocked, In progress, Ready and Not
 * started open, Done and Dropped folded. A sub-step says which step it sits
 * under on a line below its title. **Tree** is the goal's own tree, its
 * finished top-level steps folded under Finished.
 *
 * Each row is the shared row in its grid layout (goal-row.tsx): the status
 * word, the assignee circle, the date or rhythm count where the plan has
 * priority, and how much is done beneath. A stage's row says how far along
 * the stage is in that cell.
 *
 * Steps from other goals that count towards this one follow in a card of
 * their own, each naming the goal it comes from.
 */
export function StepTree({
  map,
  todoOn,
  stages: given,
  view = 'status',
  unfolded = true,
  opened = false,
  informationSeam,
  runs = NO_RUNS,
  files = NO_FILES,
  progress = NO_PROGRESS,
  arrivals = NO_ARRIVALS,
  canRun = true,
}: {
  map: GoalMap;
  todoOn: boolean;
  /**
   * The goal's stages, as the page read them with `goalStages`, for what a
   * stage's row says about how far along it is. Left out, they are read here.
   */
  stages?: Stage[] | null;
  /** By status, or the tree. From the address, `?view=tree`. */
  view?: GoalStepsView;
  /** The latest run on each step sent or prepared from its row, by step id (plan #1044). */
  runs?: Record<string, StepRunView>;
  /** The files each step links to, by step id. */
  files?: Record<string, LinkedFile[]>;
  /**
   * The progress logged on the goal and each step, by item id (plan #1276).
   * A step with none is not in it and reads as it always has.
   */
  progress?: Record<string, ItemProgress>;
  /** The finished steps Dash closed lately, by id (plan #1561). */
  arrivals?: readonly string[];
  /** Start with every step's sub-steps showing. */
  unfolded?: boolean;
  /** Start with every step opened. A seam for the gallery; nothing in the app passes it. */
  opened?: boolean;
  /** An information step's list as the gallery wants it. Nothing in the app passes it. */
  informationSeam?: InformationSeam;
  /** Whether this account can start a goals run, which Ask Dash on each row needs. */
  canRun?: boolean;
}) {
  const [showAside, setShowAside] = useState(false);
  const aside = countAside(map.steps);
  const { own, linked, context } = useGoalRows(map, {
    todoOn,
    showAside,
    unfolded,
    opened,
    informationSeam,
    runs,
    files,
    progress,
    arrivals,
    canRun,
  });

  const stages = useMemo(
    () => (given === undefined ? goalStages(map.steps) : given),
    [given, map.steps],
  );
  const groups = useMemo(() => goalStepGroups(own.rows), [own.rows]);
  const stageOf = new Map((stages ?? []).map((stage) => [stage.id, stage]));
  const readElsewhere = context.readElsewhere ?? new Set<string>();
  const substeps = own.rows.filter((row) => row.kind !== 'decision');
  const openTop = own.rows.filter((row) => staysOpen(row.step, readElsewhere));
  const finishedTop = own.rows.filter((row) => !staysOpen(row.step, readElsewhere));
  const summaryOf = (row: GoalRowNode) => {
    const stage = stageOf.get(row.id);
    return stage ? stageMeta(stage) : undefined;
  };
  const topRow = (row: GoalRowNode) => (
    <GoalRow
      key={row.id}
      node={row}
      trail={[]}
      context={context}
      index={substeps.findIndex((step) => step.id === row.id)}
      count={substeps.length}
      summary={summaryOf(row)}
    />
  );

  if (map.steps.length === 0) {
    return (
      <section aria-label="Steps" className="space-y-2">
        <EmptyState
          icon={ListTree}
          title="No steps yet"
          description="Break the goal into the things that have to happen. Any step can hold sub-steps of its own."
        />
        <StepComposer parentId={map.goal.id} label="Add a step" />
      </section>
    );
  }

  return (
    <div className="space-y-3">
      <StepFinder goalId={map.goal.id} steps={map.steps} />
      <ViewChips
        view={view}
        chips={GOAL_STEPS_VIEWS}
        labels={VIEW_LABEL}
        hrefOf={(candidate) => goalStepsViewHref(map.goal.id, candidate)}
        scroll={false}
      />
      <Card padding="none" className="overflow-hidden">
        <ul className="divide-y divide-border">
          <ColumnHeader priority="When" />
          {view === 'tree'
            ? openTop.map(topRow)
            : groups.map((group) => (
                <StepGroupRows
                  key={group.id}
                  label={group.label}
                  count={group.steps.length}
                  folded={group.folded}
                  anchors={group.steps.map(({ row }) => `step-${row.id}`)}
                >
                  {group.steps.map(({ row, parent, index, count }) => (
                    <GoalRow
                      key={row.id}
                      node={row}
                      trail={[]}
                      context={context}
                      index={index}
                      count={count}
                      summary={summaryOf(row)}
                      under={parent ? `Under #${parent.outline} ${parent.title}` : undefined}
                    />
                  ))}
                </StepGroupRows>
              ))}
        </ul>
        {view === 'tree' && finishedTop.length > 0 && (
          <div className="border-t border-border px-3 py-1.5">
            <FinishedFold count={finishedTop.length}>
              {() => <ul className="-ml-5.5 divide-y divide-border">{finishedTop.map(topRow)}</ul>}
            </FinishedFold>
          </div>
        )}
        {/* Inside the card, under a rule, as the plan's "Add a step" sits at
            the foot of a module (plan #983). */}
        <div className="border-t border-border px-3 py-1.5">
          <StepComposer parentId={map.goal.id} label="Add a step" bare />
        </div>
      </Card>

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

      {linked.length > 0 && (
        <section aria-labelledby="linked-heading" className="space-y-2">
          <h2 id="linked-heading" className="px-1 text-ui font-semibold text-ink">
            Also counts towards this goal
          </h2>
          <Card padding="none" className="overflow-hidden">
            <ul className="divide-y divide-border">
              <ColumnHeader priority="When" />
              {linked.map(({ entry, row }) => (
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
          </Card>
        </section>
      )}
    </div>
  );
}

/**
 * A goal's steps as rows, and what every row on the page shares: the goal
 * page's tree and a step's own page (plan #1620) draw the same rows from
 * this. While a step's run is going it reads the page again now and then,
 * so the row moves on to what the run is on now and then to how it ended.
 */
export function useGoalRows(
  map: GoalMap,
  {
    todoOn,
    showAside = false,
    unfolded,
    opened = false,
    informationSeam,
    runs = NO_RUNS,
    files = NO_FILES,
    progress = NO_PROGRESS,
    arrivals = NO_ARRIVALS,
    canRun = true,
  }: {
    todoOn: boolean;
    showAside?: boolean;
    unfolded: boolean;
    opened?: boolean;
    informationSeam?: InformationSeam;
    runs?: Record<string, StepRunView>;
    files?: Record<string, LinkedFile[]>;
    progress?: Record<string, ItemProgress>;
    arrivals?: readonly string[];
    canRun?: boolean;
  },
) {
  const router = useRouter();
  const anyRunning = Object.values(runs).some((run) => run.running !== null);
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(() => router.refresh(), RUN_POLL_MS);
    return () => clearInterval(timer);
  }, [anyRunning, router]);

  return useMemo(() => {
    const trees = [map.steps, ...map.linked.map((entry) => [entry.step])];
    const numbers = numberSteps(trees);
    const outlines = outlineSteps(trees);
    const options = { numbers, outlines, threads: map.threads, showAside };
    const preps = stepPreps(trees);
    const context: GoalRowContext = {
      goalId: map.goal.id,
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
      arrivals: new Set(arrivals),
      canRun,
      ...preps,
      // A prep step's result is read on the step it prepares.
      readElsewhere: new Set(Object.keys(preps.targetOf)),
    };
    return {
      own: goalRows(map.steps, options),
      linked: map.linked.flatMap((entry) => {
        const row = goalRows([entry.step], options).rows[0];
        return row ? [{ entry, row }] : [];
      }),
      context,
    };
  }, [
    map,
    todoOn,
    showAside,
    unfolded,
    opened,
    informationSeam,
    runs,
    files,
    progress,
    arrivals,
    canRun,
  ]);
}
