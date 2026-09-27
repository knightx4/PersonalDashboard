'use client';

import { useActionState } from 'react';
import { ChevronRight, ExternalLink } from 'lucide-react';
import { FileBody } from '@/components/files/file-body';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { Finding } from '@/lib/goals/goal-page';
import { linkBareDomains } from '@/lib/goals/result-links';
import { reviewResultAction, type ShapingActionState } from './shaping-actions';

const initial: ShapingActionState = {};

/** "transalt.org/volunteer" for https://www.transalt.org/volunteer/, to name a link by where it goes. */
function placeOf(url: string): string {
  try {
    const { hostname, pathname } = new URL(url);
    const path = pathname.replace(/\/+$/, '');
    return `${hostname.replace(/^www\./, '')}${path}`;
  } catch {
    return url;
  }
}

/**
 * One thing Dash found, as a line that opens to the whole result.
 *
 * It used to link to its step's row, which sits just above it on the page and
 * stays closed until its own arrow is pressed, so pressing a finding appeared
 * to do nothing. Open, it shows the result with its links, where to go from
 * it, and Mark read while it is unread, so it is read and acted on here.
 */
export function FindingRow({ finding }: { finding: Finding }) {
  const [state, review, reviewing] = useActionState(reviewResultAction, initial);
  return (
    <li className="card-pad-x row-pad">
      <details className="group/finding">
        <summary
          className={cn(
            'flex cursor-pointer list-none flex-col gap-x-4 gap-y-0.5 sm:flex-row sm:items-baseline sm:justify-between',
            'rounded-control focus-visible:outline-2 focus-visible:outline-offset-2',
            '[&::-webkit-details-marker]:hidden',
          )}
        >
          <span className="flex min-w-0 items-baseline gap-1.5">
            <ChevronRight
              aria-hidden
              strokeWidth={2}
              className="size-3.5 shrink-0 translate-y-0.5 text-ink-muted transition-transform duration-150 group-open/finding:rotate-90"
            />
            <span className="min-w-0 text-ui break-words text-ink">
              {finding.unread && <span className="sr-only">Unread. </span>}
              {finding.fact}
            </span>
          </span>
          <span className="shrink-0 pl-5 text-small text-ink-ghost sm:max-w-xs sm:truncate sm:pl-0 sm:text-right">
            {finding.unread ? 'To read · ' : ''}
            {finding.from}
          </span>
        </summary>
        <div className="mt-2 space-y-2 pl-5">
          <FileBody markdown={linkBareDomains(finding.result)} compact />
          <div className="flex flex-wrap items-center gap-2">
            {finding.url && (
              <a
                href={finding.url}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: 'secondary', size: 'sm' })}
              >
                <ExternalLink className="size-3.5" aria-hidden />
                Open {placeOf(finding.url)}
              </a>
            )}
            {finding.unread && (
              <form action={review}>
                <input type="hidden" name="id" value={finding.stepId} />
                <Button type="submit" size="sm" variant="ghost" pending={reviewing}>
                  Mark read
                </Button>
              </form>
            )}
            <a
              href={`#step-${finding.stepId}`}
              className="text-small text-ink-muted underline-offset-2 hover:text-ink hover:underline"
            >
              Go to the step
            </a>
            {state.error && <span className="text-small text-danger">{state.error}</span>}
          </div>
        </div>
      </details>
    </li>
  );
}
