'use client';

import { useState } from 'react';
import { ARRIVED_KEY } from '@/app/goals/[goalId]/dash-arrival';
import { GoalStepsFold } from '@/app/goals/[goalId]/goal-close';
import { DashOnCard } from '@/app/goals/[goalId]/goal-dashboard';
import { GoalPlan } from '@/app/goals/[goalId]/goal-plan';
import { Button } from '@/components/ui/button';
import { goalProgress } from '@/lib/goals/status';
import { SetTab } from './set-tab';
import { TabbedGoal, tabbedMap } from './goal-page-surfaces';

/**
 * The two Goals moments on the goal page's Plan tab (plan #1672, #2778.10)
 * and Dash's card on its Dashboard, played on demand for `npm run record`. Nothing is written anywhere.
 */

const progress = goalProgress(tabbedMap.steps);
/**
 * The goal with only its finished steps, so the Plan tab's fold is on screen
 * and the page's figures agree with what it says.
 */
type Nodes = typeof tabbedMap.steps;
function finishedOnly(nodes: Nodes): Nodes {
  return nodes.flatMap((node) => {
    const children = finishedOnly(node.children);
    return node.status === 'done' || children.length > 0 ? [{ ...node, children }] : [];
  });
}
const TODAY = '2026-09-25';
/**
 * Both finished steps are in the fold at rest, so every count on the screen
 * agrees before the press as after it; the press opens the tab afresh and
 * replays Draft what to say on the call arriving (plan #2778.11).
 */
const finished = { ...tabbedMap, steps: finishedOnly(tabbedMap.steps) };
const counted = goalProgress(finished.steps);
/** Everything on the plan is finished, as the page says; the progress and tab count agree. */
const allDone = {
  ...counted,
  done: counted.live,
  bands: { ...counted.bands, on_you: 0, waiting: 0, with_dash: 0, done: counted.live },
};

const stepsMeta = `${progress.done} of ${progress.live} done`;

/**
 * Closing the goal with the Plan tab open: the hexagon in the title
 * completes with its ring and the steps fold into one line. On the Dashboard
 * only the ring plays, since the steps are not on screen.
 */
export function GoalPageCloseDemo() {
  const [closed, setClosed] = useState(false);
  return (
    <div className="space-y-4">
      <SetTab tab="plan" />
      <Button
        variant="secondary"
        size="sm"
        className="active:bg-sunken"
        data-motion-demo="goal-page-close"
        onClick={() => setClosed(!closed)}
      >
        {closed ? 'Reopen the goal' : 'Close the goal'}
      </Button>
      <TabbedGoal closed={closed}>
        <GoalStepsFold closed={closed} meta={stepsMeta}>
          <GoalPlan
            map={tabbedMap}
            view="next"
            byStage={null}
            canRun
            today={TODAY}
            timeZone="UTC"
          />
        </GoalStepsFold>
      </TabbedGoal>
    </div>
  );
}

function forgetArrivals() {
  try {
    window.localStorage.removeItem(ARRIVED_KEY);
  } catch {
    /* Storage blocked: the arrival does not play, as in the app. */
  }
}

/**
 * The Plan tab opened afresh after Dash finished the call script: the
 * finished step's row settles in with its fold open, and Dash's mark beside
 * it flashes once.
 */
export function GoalPageArrivalDemo() {
  const [visit, setVisit] = useState(0);
  return (
    <div className="space-y-4">
      <SetTab tab="plan" />
      <Button
        variant="secondary"
        size="sm"
        className="active:bg-sunken"
        data-motion-demo="goal-page-arrival"
        onClick={() => {
          forgetArrivals();
          setVisit((n) => n + 1);
        }}
      >
        Open it as Dash finishes
      </Button>
      <TabbedGoal progress={allDone}>
        <GoalPlan
          key={visit}
          map={finished}
          view="next"
          byStage={null}
          canRun
          today={TODAY}
          timeZone="UTC"
          doneOpen
          arrivals={visit > 0 ? ['script'] : []}
        />
      </TabbedGoal>
    </div>
  );
}

/**
 * The Dashboard opened afresh after Dash finished the call script: the
 * "Last finished" line in Dash's card settles in and its mark flashes once.
 */
export function GoalDashArrivalDemo() {
  const [visit, setVisit] = useState(0);
  return (
    <div className="space-y-4">
      <SetTab tab="dashboard" />
      <Button
        variant="secondary"
        size="sm"
        className="active:bg-sunken"
        data-motion-demo="goal-dash-arrival"
        onClick={() => {
          forgetArrivals();
          setVisit((n) => n + 1);
        }}
      >
        Open it as Dash finishes
      </Button>
      <TabbedGoal>
        <DashOnCard
          key={visit}
          items={[
            visit > 0
              ? {
                  stepId: 'script',
                  runId: 'run-script',
                  title: 'Draft what to say on the call',
                  state: 'finished',
                  line: 'Wrote the script and the follow-up email.',
                }
              : {
                  stepId: 'list',
                  runId: 'run-list',
                  title: 'List every balance',
                  state: 'finished',
                  line: 'Listed the four cards and the overdraft.',
                },
          ]}
          arrivals={visit > 0 ? ['script'] : []}
        />
      </TabbedGoal>
    </div>
  );
}
