import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Meter } from '@/components/ui/meter';
import type { Finding } from '@/lib/goals/goal-page';
import { missedLine, progressLine, type RhythmRecord } from '@/lib/goals/rhythms';
import type { StepNode } from '@/lib/goals/steps';

/**
 * Two sections of the goal page (plan #1078): the rhythms the goal keeps,
 * each with this period against its target and the one before, and what Dash
 * found, each as one sentence beside the step it came from. The step holds
 * the whole of it, and the sentence opens there.
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
    <section aria-labelledby="rhythm-heading" className="space-y-2">
      <h2 id="rhythm-heading" className="px-1 text-ui font-semibold text-ink">
        Rhythm
      </h2>
      <Card padding="none">
        <ul className="divide-y divide-border">
          {steps.map((step) => {
            const period = step.rhythmPeriod!;
            const record = records[step.id];
            const now = record?.current ?? null;
            const last = record?.past.at(-1) ?? null;
            const facts = [
              now ? progressLine(period, now) : null,
              last ? `${last.count} last ${period}` : null,
              record && record.missed > 0 ? missedLine(period, record.missed) : null,
            ].filter(Boolean);
            return (
              <li key={step.id} className="card-pad-x row-pad flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <div className="min-w-0 space-y-0.5">
                  <a href={`#step-${step.id}`} className="text-ui font-medium break-words text-ink underline-offset-2 hover:underline">
                    {step.title}
                  </a>
                  <p className="tabular text-small text-ink-muted">
                    {facts.length > 0 ? facts.join(' · ') : `${step.rhythmCount} a ${period}, nothing counted yet`}
                  </p>
                </div>
                {now && (
                  <Meter
                    value={now.count}
                    max={now.target}
                    fill="bg-positive"
                    minFraction={0.04}
                    label={`${step.title}: ${progressLine(period, now)}`}
                    className="w-24"
                  />
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}

export function GoalFindings({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) return null;
  return (
    <section aria-labelledby="found-heading" className="space-y-2">
      <h2 id="found-heading" className="px-1 text-ui font-semibold text-ink">
        What Dash found
      </h2>
      <Card padding="none">
        <ul className="divide-y divide-border">
          {findings.map((finding) => (
            <li
              key={finding.stepId}
              className="card-pad-x row-pad flex flex-col gap-x-4 gap-y-0.5 sm:flex-row sm:items-baseline sm:justify-between"
            >
              <p className="min-w-0 text-ui break-words text-ink">
                <a href={`#step-${finding.stepId}`} className="underline-offset-2 hover:underline">
                  {finding.fact}
                </a>
                {finding.url && (
                  <Link
                    href={finding.url}
                    className="ml-1.5 inline-flex translate-y-0.5 text-ink-muted hover:text-ink"
                    aria-label={`Open where “${finding.from}” lives`}
                  >
                    <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden />
                  </Link>
                )}
              </p>
              <span className="shrink-0 text-small text-ink-ghost sm:max-w-xs sm:truncate sm:text-right">
                {finding.from}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
