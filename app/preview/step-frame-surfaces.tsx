'use client';

import { GoalStepSurface } from './goal-surfaces';
import { OpenMenu } from './goal-put-away-surfaces';

/**
 * A step's page with its menu open from the title's line (plan #2373.1), as
 * the goal page's heading menu opens.
 */
export function GoalStepMenuSurface() {
  return (
    <OpenMenu trigger={'button[aria-label^="Actions for #"]'}>
      <GoalStepSurface />
    </OpenMenu>
  );
}

/**
 * A step's Overview with its done-when being written (plan #2373.2): the
 * editor that opens in place when the done-when is pressed.
 */
export function GoalStepEditingSurface() {
  return (
    <OpenMenu trigger={'button[title^="Edit when"]'}>
      <GoalStepSurface />
    </OpenMenu>
  );
}
