import { Meter } from '@/components/ui/meter';
import { missedLine, progressLine, type RhythmRecord } from '@/lib/goals/rhythms';
import type { StepNode } from '@/lib/goals/steps';

/**
 * The rhythms the goal keeps, as a strip under Now (plan #1078): each one's
 * name, this period's count against its target, where the count comes from
 * when it is not kept by hand, and any periods missed in a row ("Applications
 * 2 of 5 this week from Jobs"). The name goes to the rhythm's row, where it is
 * counted and its past periods are.
 */
export function GoalRhythms({
  steps,
  records,
}: {
  steps: StepNode[];
  records: Record<string, RhythmRecord>;
}) {
  if (steps.length === 0) return null;
  return (
    <ul aria-label="Rhythms" className="flex flex-wrap gap-x-5 gap-y-1.5 px-1">
      {steps.map((step) => {
        const period = step.rhythmPeriod!;
        const record = records[step.id];
        const now = record?.current ?? null;
        const facts = [
          now
            ? progressLine(period, now, step.countSource)
            : `${step.rhythmCount} a ${period}, nothing counted yet`,
          record && record.missed > 0 ? missedLine(period, record.missed) : null,
        ].filter(Boolean);
        return (
          <li key={step.id} className="flex min-w-0 items-center gap-2 text-small">
            {now && (
              <Meter
                value={now.count}
                max={now.target}
                fill="bg-positive"
                minFraction={0.04}
                label={`${step.title}: ${progressLine(period, now)}`}
                className="w-10 shrink-0"
              />
            )}
            <span className="min-w-0 break-words">
              <a
                href={`#step-${step.id}`}
                className="font-medium text-ink underline-offset-2 hover:underline"
              >
                {step.title}
              </a>
              <span className="tabular text-ink-muted"> {facts.join(' · ')}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
