'use client';

import type { LinkedFile } from '@/lib/files/files';
import { useMemo, useState, type ReactNode } from 'react';
import { useRunRefresh } from '@/components/runs/use-run-refresh';
import { ListTree } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ColumnHeader } from '@/components/plan-tree/grid';
import { EmptyState } from '@/components/ui/empty-state';
import {
  goalCatalog,
  goalRows,
  numberSteps,
  outlineSteps,
  staysOpen,
  type GoalRowNode,
} from '@/lib/goals/plan-rows';
import { goalStages, nowLabel, nowStages, stepPreps, type Stage } from '@/lib/goals/goal-page';
import { latestBeneath, type ItemProgress } from '@/lib/goals/progress';
import { countAside, type StepRunView } from '@/lib/goals/shaping';
import type { GoalMap } from '@/lib/goals/steps-store';
import { SiblingMoveProvider, useSiblingOrder } from '@/lib/use-sibling-order';
import { FinishedFold, GoalRow, writeStepMove, type GoalRowContext } from './goal-row';
import { StepComposer } from './step-parts';
import { StepFinder } from './step-finder';
import type { InformationSeam } from './information-step';

const NO_RUNS: Record<string, StepRunView> = {};
const NO_FILES: Record<string, LinkedFile[]> = {};
const NO_PROGRESS: Record<string, ItemProgress> = {};
const NO_ARRIVALS: readonly string[] = [];

type Placed = { row: GoalRowNode; stage?: Stage };

/**
 * The header over a goal's steps: the dev plan's, with When in place of
 * Priority (plan #2069.2). tests/plan-view.test.tsx fails if the two stop
 * drawing the same columns.
 */
export function GoalColumnHeader() {
  // On a phone the row shows its cells without columns, so a header there
  // would hold the one word Step.
  return <ColumnHeader priority="When" className="max-sm:hidden" />;
}

/**
 * A goal's steps (plan #925), in two parts (plan #1078).
 *
 * **Now** is the work in hand. On a goal in stages it is the stages
 * `nowStages` opens, each a row with its open steps beneath it, and any open
 * step outside the stages; on a goal that is one list, every open step.
 * **Other stages** is the rest of the map: each stage one row, folded, saying
 * whether it is done, how far along it is or what it waits on, and opening in
 * place when pressed. Finished steps fold under Finished at every level, and
 * what Dash wrote for a step is a fold on that step's row.
 *
 * Each card opens with the dev plan's column header, Step, Status, Assignee,
 * When and Steps, and each step is the plan's shared row on those columns
 * (goal-row.tsx; plan #2069.2), so a goal reads the way /dev/plan does. When
 * is the plan's Priority column holding a step's date. There is no tally,
 * banded bar or view chips: Open, On you and Everything were a way to cut the
 * one long list; Now and the map cut it by stage instead, Waiting on you at
 * the top of the page lists what is on you, and Finished is a fold rather
 * than a view.
 *
 * Steps from other goals that count towards this one follow in a card of
 * their own, each naming the goal it comes from.
 */
export function StepTree({
  map,
  todoOn,
  stages: given,
  unfolded = true,
  opened = false,
  informationSeam,
  tipOpenFor,
  runs = NO_RUNS,
  files = NO_FILES,
  progress = NO_PROGRESS,
  arrivals = NO_ARRIVALS,
  canRun = true,
  belowNow,
}: {
  map: GoalMap;
  todoOn: boolean;
  /**
   * The goal's stages, as the page read them with `goalStages`. Null draws
   * the goal as one list, which an errand always is; left out, they are read
   * here.
   */
  stages?: Stage[] | null;
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
  /** The step whose Assignee tooltip starts open. A seam for the gallery; nothing in the app passes it. */
  tipOpenFor?: string;
  /** Whether this account can start a goals run, which Ask Dash on each row needs. */
  canRun?: boolean;
  /** Drawn under Now, before the other stages: the page's strip of rhythms. */
  belowNow?: ReactNode;
}) {
  const [showAside, setShowAside] = useState(false);
  const aside = countAside(map.steps);
  const { own, linked, context } = useGoalRows(map, {
    todoOn,
    showAside,
    unfolded,
    opened,
    informationSeam,
    tipOpenFor,
    runs,
    files,
    progress,
    arrivals,
    canRun,
  });

  // The goal's own steps in the order their list holds, so Move up on one
  // swaps it before the server has answered (plan #1851).
  const order = useSiblingOrder(own.rows, writeStepMove);
  const rows = order.ordered as GoalRowNode[];

  const stages = useMemo(
    () => (given === undefined ? goalStages(map.steps) : given),
    [given, map.steps],
  );

  const now = useMemo(() => nowStages(stages, map.steps), [stages, map.steps]);
  const stageOf = new Map((stages ?? []).map((stage) => [stage.id, stage]));
  const readElsewhere = context.readElsewhere ?? new Set<string>();
  const inNow: Placed[] = [];
  const onMap: Placed[] = [];
  const finished: GoalRowNode[] = [];
  for (const row of rows) {
    const stage = stageOf.get(row.id);
    if (stage) (now.has(row.id) ? inNow : onMap).push({ row, stage });
    else if (staysOpen(row.step, readElsewhere)) inNow.push({ row });
    else finished.push(row);
  }
  const substeps = rows.filter((row) => row.kind !== 'decision');
  const rowOf = ({ row }: Placed, folded = false) => (
    <GoalRow
      key={row.id}
      node={row}
      trail={[]}
      context={context}
      index={substeps.findIndex((step) => step.id === row.id)}
      count={substeps.length}
      unfolded={folded ? false : undefined}
    />
  );
  const finishedFold = finished.length > 0 && (
    <div className="border-t border-border px-3 py-1.5">
      <FinishedFold count={finished.length}>
        {() => (
          <ul className="-mr-3 -ml-5.5 divide-y divide-border">
            {finished.map((row) => rowOf({ row }))}
          </ul>
        )}
      </FinishedFold>
    </div>
  );
  // Inside the last card, under a rule, as the plan's "Add a step" sits at
  // the foot of a module (plan #983).
  const composer = (
    <div className="border-t border-border px-3 py-1.5">
      <StepComposer parentId={map.goal.id} label="Add a step" bare />
    </div>
  );
  const nowMeta = stages ? nowLabel(stages, now) : null;

  if (map.steps.length === 0) {
    return (
      <section aria-label="Steps" className="space-y-2">
        <EmptyState
          icon={ListTree}
          title="No steps yet"
          description={
            canRun
              ? 'Press Map it out above and Dash lays the steps out, or add your own. Any step can hold sub-steps of its own.'
              : 'Break the goal into the things that have to happen. Any step can hold sub-steps of its own.'
          }
        />
        <StepComposer parentId={map.goal.id} label="Add a step" />
      </section>
    );
  }

  return (
    <SiblingMoveProvider move={order.move}>
      <div className="space-y-6">
        <StepFinder goalId={map.goal.id} steps={map.steps} />
        <section aria-labelledby="now-heading" className="space-y-2">
          <h2
            id="now-heading"
            className="flex items-baseline gap-2 px-1 text-ui font-semibold text-ink"
          >
            Now
            {nowMeta && <span className="text-small font-normal text-ink-muted">{nowMeta}</span>}
          </h2>
          <Card padding="none">
            {inNow.length > 0 ? (
              <ul className="divide-y divide-border">
                <GoalColumnHeader />
                {inNow.map((placed) => rowOf(placed))}
              </ul>
            ) : (
              <p className="px-3 py-2.5 text-ui text-ink-muted">
                {stages ? 'Every stage is done.' : 'Every step is done or dropped.'}
              </p>
            )}
            {!stages && finishedFold}
            {!stages && composer}
          </Card>
          {belowNow}
        </section>

        {stages && (
          <section aria-labelledby="map-heading" className="space-y-2">
            <h2
              id="map-heading"
              className="flex items-baseline gap-2 px-1 text-ui font-semibold text-ink"
            >
              Other stages
              <span className="tabular text-small font-normal text-ink-muted">{onMap.length}</span>
            </h2>
            <Card padding="none">
              {onMap.length > 0 && (
                <ul className="divide-y divide-border">
                  <GoalColumnHeader />
                  {onMap.map((placed) => rowOf(placed, true))}
                </ul>
              )}
              {finishedFold}
              {composer}
            </Card>
          </section>
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

        {linked.length > 0 && (
          <section aria-labelledby="linked-heading" className="space-y-2">
            <h2 id="linked-heading" className="px-1 text-ui font-semibold text-ink">
              Also counts towards this goal
            </h2>
            <Card padding="none">
              <ul className="divide-y divide-border">
                <GoalColumnHeader />
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
    </SiblingMoveProvider>
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
    tipOpenFor,
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
    tipOpenFor?: string;
    runs?: Record<string, StepRunView>;
    files?: Record<string, LinkedFile[]>;
    progress?: Record<string, ItemProgress>;
    arrivals?: readonly string[];
    canRun?: boolean;
  },
) {
  const anyRunning = Object.values(runs).some((run) => run.running !== null);
  useRunRefresh(anyRunning);

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
      tipOpenFor,
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
    tipOpenFor,
    runs,
    files,
    progress,
    arrivals,
    canRun,
  ]);
}
