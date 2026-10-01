'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { GoalGlyph, GoalStepsFold } from '@/app/goals/[goalId]/goal-close';
import { goalGlyph } from '@/lib/goals/status';

const STEPS = ['Get the balances', 'Pick the order to pay them in', 'Set up the payments'];

/**
 * A goal closing on its page (plan #1341), on demand: the hexagon completes
 * with one ring in the accent and the steps fold into one line. Taking it back
 * up puts the steps back at once. Under reduced motion only the end state
 * appears.
 */
export function GoalCloseDemo() {
  const [closed, setClosed] = useState(false);
  const progress = { live: STEPS.length, done: STEPS.length };
  const hexagon = goalGlyph(closed ? 'done' : 'open', progress);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="secondary" onClick={() => setClosed((now) => !now)}>
          {closed ? 'Take it back up' : 'Close the goal'}
        </Button>
        <span className="flex items-center gap-2.5 font-display text-title tracking-tight text-ink">
          <GoalGlyph glyph={hexagon.glyph} label={hexagon.label} closed={closed} />
          Pay off the debts
        </span>
      </div>
      <GoalStepsFold closed={closed} meta={`${progress.done} of ${progress.live} done`}>
        <ul className="divide-y divide-border">
          {STEPS.map((step) => (
            <li key={step} className="row-pad text-ui text-ink">
              {step}
            </li>
          ))}
        </ul>
      </GoalStepsFold>
    </div>
  );
}
