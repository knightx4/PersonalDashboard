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
