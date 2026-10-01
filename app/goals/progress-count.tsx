'use client';

import { useCountUp } from '@/components/ui/motion';
import { progressWords, type GoalProgress } from '@/lib/goals/status';

/**
 * "3 of 7 steps done", with the done count counting to its new value when a
 * step closes on screen (plan #1342). It starts at the value it is given, so
 * a page that loads shows the final count at once.
 */
export function ProgressCount({ progress }: { progress: GoalProgress }) {
  const done = useCountUp(progress.done);
  return <span className="tabular text-small text-ink-muted">{progressWords({ ...progress, done })}</span>;
}
