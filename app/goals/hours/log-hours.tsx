import { Card } from '@/components/ui/card';
import { LogDone } from '@/components/goals/log-done';

/**
 * The slot at the top of the Hours page for logging today's hours (note
 * 3eb2c302). It is the "What did you do?" box from Home and a goal's
 * Overview, so "applied 2h, cleaned 1.5h" is filed against the goals the way
 * the capture box files it, and the page redraws with the hours counted.
 */
export function LogHours({
  initialOpen,
  initial,
}: {
  /** Drawn open, for the gallery. */
  initialOpen?: boolean;
  /** Lines already filed, for the gallery. */
  initial?: React.ComponentProps<typeof LogDone>['initial'];
}) {
  return (
    <Card padding="standard">
      <LogDone
        label="Log hours for today"
        placeholder="e.g. applied 2h, cleaned 1.5h"
        initial={initial}
        initialOpen={initialOpen}
      />
    </Card>
  );
}
