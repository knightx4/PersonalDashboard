'use client';

import { Check, ExternalLink } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { useOptimisticWrite } from '@/lib/use-optimistic-write';
import { confirmIssue } from '@/app/news/i/[id]/actions';

/**
 * Confirm, or the line saying it was (plan #1724). For a signup email that
 * carried a confirmation link: Confirm opens the link in a new tab and notes
 * the press, and once noted the button gives way to "Confirmed <when>".
 *
 * The button is the link itself, so the browser opens it on the press and the
 * server visits nothing. The press also runs confirmIssue to set confirmed_at,
 * optimistically: the line shows at once, and a refused write puts the button
 * back with a toast (useOptimisticWrite). Without script the link still opens
 * and the press goes unrecorded.
 *
 * Shared with the Needs confirming section on the newsletter list (#1725).
 * `confirmedLabel` is when it was confirmed, formatted by the page, or null
 * while it has not been.
 */
export function ConfirmSignup({
  issueId,
  url,
  confirmedLabel,
  className,
}: {
  issueId: string;
  url: string;
  confirmedLabel: string | null;
  className?: string;
}) {
  const { shown, run, failed } = useOptimisticWrite<boolean, boolean>({
    value: confirmedLabel !== null,
    apply: (_current, next) => next,
    write: () => confirmIssue(issueId),
  });

  if (shown) {
    return (
      <p className={cn('flex items-center gap-1.5 text-ui text-ink-muted', className)}>
        <Check className="size-3.5"strokeWidth={1.75} aria-hidden />
        {confirmedLabel ? `Confirmed ${confirmedLabel}` : 'Confirmed just now'}
      </p>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title="Open the confirmation link in a new tab"
      onClick={() => run(true)}
      className={cn(
        'w-fit',
        buttonVariants({ variant: 'primary', size: 'sm' }),
        failed && 'ring-2 ring-danger',
        className,
      )}
    >
      Confirm
      <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden />
    </a>
  );
}
