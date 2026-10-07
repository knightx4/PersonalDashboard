'use client';

import { useMemo, useState } from 'react';
import { ARRIVED_KEY } from '@/app/goals/[goalId]/dash-arrival';
import { StepCloseRing } from '@/app/goals/[goalId]/s/[stepId]/step-close';
import { StepPage } from '@/app/goals/[goalId]/step-page';
import { Button } from '@/components/ui/button';
import { goalMapWith } from './goal-surfaces';

/**
 * The two Goals moments on a step's own page (plan #1623), played on demand
 * for `npm run record`: closing the step grows the ring out of its glyph, and
 * a step Dash finished settles in with Dash's mark flashing once. Nothing is
 * written anywhere; the arrival demo only clears this browser's record of
 * which arrivals were seen, so it can play again.
 */

/** Call the card company, closed on its own page. */
export function StepCloseDemo() {
  const [closed, setClosed] = useState(false);
  const map = useMemo(
    () =>
      goalMapWith(closed ? { call: { status: 'done', blockKind: null, blockAsk: null } } : {}),
    [closed],
  );
  return (
    <div className="space-y-4">
      <Button
        variant="secondary"
        size="sm"
        data-motion-demo="step-close"
        onClick={() => setClosed(!closed)}
      >
        {closed ? 'Reopen the step' : 'Close the step'}
      </Button>
      <StepCloseRing closed={closed}>
        <StepPage map={map} stepId="call" todoOn={false} />
      </StepCloseRing>
    </div>
  );
}

/**
 * Draft what to say on the call, Dash's step, opened just after Dash
 * finished it. Each press opens the page afresh, as arriving from a link
 * would.
 */
export function StepArrivalDemo() {
  const [visit, setVisit] = useState(0);
  const map = useMemo(() => goalMapWith({}), []);
  return (
    <div className="space-y-4">
      <Button
        variant="secondary"
        size="sm"
        data-motion-demo="step-arrival"
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
      <StepPage
        key={visit}
        map={map}
        stepId="script"
        todoOn={false}
        arrivals={visit > 0 ? ['script'] : []}
      />
    </div>
  );
}
