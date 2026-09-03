'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * What a route group shows when it throws.
 *
 * It says what could not be done, not what the exception was: a stack trace is
 * for the log, and "TypeError: Cannot read properties of undefined" tells the
 * person reading it nothing they can act on. The digest is shown small,
 * because it is the one string worth quoting in a bug report.
 *
 * There is always a way out -- retry, and somewhere else to be.
 */
export function RouteError({
  what,
  error,
  reset,
  backHref,
  backLabel,
}: {
  /** "your inventory", "this note" -- completes "We could not load ___." */
  what: string;
  error: Error & { digest?: string };
  reset: () => void;
  backHref: string;
  backLabel: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg rounded-card border border-border bg-surface p-8 text-center">
      <h1 className="font-display text-title tracking-tight text-ink">
        We could not load {what}.
      </h1>
      <p className="mt-2 text-body text-ink-muted">
        Nothing has been lost. This is usually temporary — trying again is the first thing worth
        doing.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Button onClick={reset}>
          <RotateCcw className="size-4" strokeWidth={2} aria-hidden />
          Try again
        </Button>
        <Link
          href={backHref}
          className="press inline-flex h-10 items-center rounded-lg border border-border bg-surface px-4 text-body font-medium text-ink hover:bg-sunken"
        >
          {backLabel}
        </Link>
      </div>
      {error.digest && (
        <p className="mt-5 font-mono text-micro text-ink-ghost">Reference {error.digest}</p>
      )}
    </div>
  );
}
