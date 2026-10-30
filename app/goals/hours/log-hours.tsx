import { Card } from '@/components/ui/card';
import { LogDone } from '@/components/goals/log-done';

/**
 * The slot at the top of the Hours page for logging hours (note 3eb2c302).
 * It is the "What did you do?" box from Home and a goal's Overview, so
 * "applied 2h, cleaned 1.5h" is filed against the goals the way the capture
 * box files it, and the page redraws with the hours counted. Its date chip
 * starts on today and goes back to an earlier day (note 2653989d).
 */
export function LogHours({
  today,
  earliest,
  initialOpen,
  initial,
}: {
  /** Today in the person's timezone, and the earliest day the chip offers. */
  today: string;
  earliest: string;
  /** Drawn open, for the gallery. */
  initialOpen?: boolean;
  /** Lines already filed, for the gallery. */
  initial?: React.ComponentProps<typeof LogDone>['initial'];
}) {
  return (
    <Card padding="standard">
      <LogDone
        label="Log hours"
        placeholder="e.g. applied 2h, cleaned 1.5h"
        days={{ today, earliest }}
        initial={initial}
        initialOpen={initialOpen}
      />
    </Card>
  );
}
