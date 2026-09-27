import Link from 'next/link';
import { elapsedSince } from '@/lib/plan/elapsed';
import type { VisionReviewStatus } from '@/lib/specs/vision-review-run';

/** A date as the line says it: "Sunday 4 October". UTC, as the schedule is. */
function day(at: string): string {
  return new Date(at).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

/** "3d 2h ago", or "just now". */
function ago(at: string, now: number): string {
  const since = elapsedSince(at, now);
  return since === 'just now' ? since : `${since} ago`;
}

/**
 * The weekly vision review's row in the Status panel (plan #1108).
 *
 * It runs by itself on Sundays, so there is nothing to press: the row says when
 * it last ran, when it runs next, and how many edits it left waiting on the
 * specs page. A fire that failed after the last run is said, with its reason,
 * because until it is fixed the row would otherwise go on reading as fine.
 */
export function VisionReviewLine({ status, now }: { status: VisionReviewStatus; now: number }) {
  const { lastRunAt, failed, nextAt, pendingEdits } = status;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-ui font-medium text-ink">Vision review</h3>
        <Link href="/dev/specs" className="ml-auto text-ui text-accent hover:underline">
          Specs
        </Link>
      </div>
      <p className="text-ui text-ink-muted">
        {lastRunAt ? (
          <>
            <span className="text-ink">Last ran {ago(lastRunAt, now)}</span>, on{' '}
            {day(lastRunAt)}.{' '}
            {nextAt && new Date(nextAt).getTime() > now
              ? `Next on ${day(nextAt)}.`
              : 'Due again at the next Sunday tick.'}
          </>
        ) : (
          'Has not run yet. It runs by itself on Sundays.'
        )}
        {pendingEdits > 0 &&
          ` ${pendingEdits} proposed edit${pendingEdits === 1 ? '' : 's'} waiting on the specs page.`}
      </p>
      {failed && (
        <p className="text-ui text-ink-muted">
          The weekly start on {day(failed.at)} failed: {failed.error}
        </p>
      )}
    </div>
  );
}
