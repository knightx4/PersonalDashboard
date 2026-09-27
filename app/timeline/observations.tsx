'use client';

import { Disclosure } from '@/components/ui/disclosure';
import { Button } from '@/components/ui/button';
import { ModuleMark } from '@/components/ui/module-mark';
import { moduleById } from '@/lib/modules';
import type { ShownObservation } from '@/lib/timeline/observations-view';
import { eventRef } from '@/lib/timeline/timeline';
import { useOptimisticWrite } from '@/lib/use-optimistic-write';
import { markObservationNotUseful } from './actions';
import { EventRow } from './event-row';

/**
 * The weekly observations (plan #1120), on the home page and at the top of
 * the timeline's month: each sentence, the workspaces it crosses, "Show me"
 * folding open the rows behind it, and "Not useful", which takes it off the
 * list at once and records the verdict. A refused write puts it back with a
 * toast. The list draws nothing once it is empty; the caller decides whether
 * there is a section at all.
 */
export function ObservationList({
  observations,
  timezone,
}: {
  observations: ShownObservation[];
  timezone: string;
}) {
  const { shown, run } = useOptimisticWrite<ShownObservation[], string>({
    value: observations,
    apply: (current, id) => current.filter((observation) => observation.id !== id),
    write: (id) => markObservationNotUseful(id),
  });
  if (shown.length === 0) return null;
  return (
    <ul className="divide-y divide-border">
      {shown.map((observation) => (
        <li key={observation.id} className="py-3 first:pt-0 last:pb-0">
          <div className="flex items-start gap-3">
            <p className="min-w-0 flex-1 text-body text-ink">{observation.sentence}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-mt-0.5 shrink-0"
              title="Hide this one; the next run leaves it alone"
              onClick={() => run(observation.id)}
            >
              Not useful
            </Button>
          </div>
          <div className="mt-1.5 flex items-start gap-2">
            <Disclosure
              className="min-w-0 flex-1"
              title="Show me"
              meta={
                <span className="tabular">
                  {observation.events.length === 1 ? '1 row' : `${observation.events.length} rows`}
                </span>
              }
            >
              {observation.events.length > 0 ? (
                <ul className="divide-y divide-border border-y border-border">
                  {observation.events.map((event) => (
                    <EventRow key={eventRef(event)} event={event} timezone={timezone} withMonth />
                  ))}
                </ul>
              ) : (
                <p className="text-small text-ink-muted">The rows behind this have since been deleted.</p>
              )}
            </Disclosure>
            <span className="mt-1 flex shrink-0 items-center gap-1">
              {observation.modules.map((module) => (
                <ModuleMark key={module} module={module} size="sm" />
              ))}
              <span className="sr-only">
                {`Draws on ${observation.modules.map((module) => moduleById(module)?.label ?? module).join(' and ')}`}
              </span>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
