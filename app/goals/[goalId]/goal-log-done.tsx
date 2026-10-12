import { Card } from '@/components/ui/card';
import { LogDone } from '@/components/goals/log-done';

/**
 * The "What did you do?" box on a goal's Overview (plan #1740), under Dash's
 * status card: a quiet "Log what you did on this goal" line until pressed. What is written is filed with this goal as the likely one, so
 * "cleaned the bathroom" on the cleaning goal closes or logs progress on its
 * bathroom step, or adds one already closed. Only on an open goal.
 */
export function GoalLogDone({
  goalId,
  initial,
  initialOpen,
}: {
  goalId: string;
  /** Drawn open, for the gallery. */
  initialOpen?: boolean;
  /** Lines already filed, for the gallery. */
  initial?: React.ComponentProps<typeof LogDone>['initial'];
}) {
  return (
    <Card padding="standard">
      <LogDone
        goalId={goalId}
        label="Log what you did on this goal"
        placeholder="e.g. cleaned the bathroom"
        initial={initial}
        initialOpen={initialOpen}
      />
    </Card>
  );
}
