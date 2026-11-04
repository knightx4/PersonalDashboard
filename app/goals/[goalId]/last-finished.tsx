'use client';

import Link, { linkVariants } from '@/components/ui/link';
import { DashMark } from '@/components/ui/dash-mark';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { useDashArrival } from './dash-arrival';

/**
 * The line in Dash's card that says what it last finished. When that is a
 * step Dash closed lately and this visit is the first to see it, the line
 * settles in and Dash's mark flashes once (moment "A step Dash finished",
 * useDashArrival); under reduced motion it is simply there.
 */
export function LastFinished({
  stepId,
  arrived,
  run,
  file,
}: {
  stepId: string | null;
  /** Whether Dash closed the step lately (loadDashArrivals). */
  arrived: boolean;
  /** The run it finished, linked by its title. */
  run: { title: string; href: string } | null;
  /** Or else its newest file. */
  file: { title: string; href: string } | null;
}) {
  const plays = arrived && stepId !== null;
  const markRef = useDashArrival(stepId ?? '', plays);
  const shown = run ?? file;
  if (!shown) return null;
  return (
    <p data-arrival-row className="text-small text-ink-muted">
      Last finished:{' '}
      {plays && (
        <>
          <Tooltip label="Finished by Dash" className="shrink-0">
            <span ref={markRef} className="inline-flex translate-y-0.5 text-ink-muted">
              <DashMark size="2xs" label="Dash's" />
            </span>
          </Tooltip>{' '}
        </>
      )}
      {run ? (
        <a href={run.href} className="press-area font-medium text-ink hover:text-accent">
          {run.title}
        </a>
      ) : (
        <Link href={shown.href} className="press-area font-medium text-ink hover:text-accent">
          {shown.title}
        </Link>
      )}
      {' · '}
      <Link href="?tab=files" className={cn('press-area', linkVariants({ tone: 'quiet' }))}>
        All of Dash’s work
      </Link>
    </p>
  );
}
