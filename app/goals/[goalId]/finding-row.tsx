'use client';

import { useActionState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Disclosure } from '@/components/ui/disclosure';
import { FileBody } from '@/components/files/file-body';
import { Button, buttonVariants } from '@/components/ui/button';
import type { Finding } from '@/lib/goals/goal-page';
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
      <Disclosure
        summaryClassName="items-baseline py-0"
        bodyClassName="mt-2 space-y-2 pl-5"
        title={
          <span className="font-normal break-words">
            {finding.unread && <span className="sr-only">Unread. </span>}
            {finding.fact}
          </span>
        }
        meta={
          <span className="text-ink-ghost">
            {finding.unread ? 'To read · ' : ''}
            {finding.from}
          </span>
        }
      >
          <FileBody markdown={finding.result} compact />
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
      </Disclosure>
    </li>
  );
}
