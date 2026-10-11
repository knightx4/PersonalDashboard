'use client';

import { useState } from 'react';
import { ARRIVED_KEY } from '@/app/goals/[goalId]/dash-arrival';
import { GoalStepsFold } from '@/app/goals/[goalId]/goal-close';
import { StepTree } from '@/app/goals/[goalId]/step-tree';
import { Button } from '@/components/ui/button';
import { goalStages } from '@/lib/goals/goal-page';
import { goalProgress } from '@/lib/goals/status';
import { SetTab } from './set-tab';
import { goalMapWith } from './goal-surfaces';
import { TabbedGoal, tabbedMap } from './goal-page-surfaces';

/**
 * The two Goals moments on the goal page's Steps tab (plan #1672), played on
 * demand for `npm run record`. Nothing is written anywhere.
 */

const progress = goalProgress(tabbedMap.steps);
/**
 * Dash's finished step as the goal page shows a fresh arrival: a result not
 * yet read keeps it among the open steps, here under the first stage so it
 * is on screen when the tab opens.
 */
const arrivalMap = goalMapWith({ script: { parentId: 'owe', preparesId: null, position: 1 } });

const stepsMeta = `${progress.done} of ${progress.live} done`;

/**
 * Closing the goal with the Steps tab open: the hexagon in the title
 * completes with its ring and the steps fold into one line. On Overview
 * only the ring plays, since the steps are not on screen.
 */
export function GoalPageCloseDemo() {
  const [closed, setClosed] = useState(false);
  return (
    <div className="space-y-4">
      <SetTab tab="steps" />
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
          <StepTree map={tabbedMap} stages={goalStages(tabbedMap.steps)} todoOn={false} />
        </GoalStepsFold>
      </TabbedGoal>
    </div>
  );
}

/**
 * The Steps tab opened afresh after Dash finished the call script: the row
 * settles in and Dash's mark beside it flashes once.
 */
export function GoalPageArrivalDemo() {
  const [visit, setVisit] = useState(0);
  return (
    <div className="space-y-4">
      <SetTab tab="steps" />
      <Button
        variant="secondary"
        size="sm"
        className="active:bg-sunken"
        data-motion-demo="goal-page-arrival"
        onClick={() => {
          try {
            window.localStorage.removeItem(ARRIVED_KEY);
          } catch {
            /* Storage blocked: the arrival does not play, as in the app. */
          }
          setVisit((n) => n + 1);
        }}
      >
        Open it as Dash finishes
      </Button>
      <TabbedGoal>
        <StepTree
          key={visit}
          map={arrivalMap}
          stages={goalStages(arrivalMap.steps)}
          todoOn={false}
          arrivals={visit > 0 ? ['script'] : []}
        />
      </TabbedGoal>
    </div>
  );
}
