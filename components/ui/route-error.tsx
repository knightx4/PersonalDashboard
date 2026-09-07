'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { RotateCcw } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

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
    <Card padding="standard" className="mx-auto max-w-lg text-center">
      <h1 className="font-display text-title tracking-tight text-ink">
        We could not load {what}.
      </h1>
      <p className="mt-2 text-body text-ink-muted">
        Nothing has been lost. This is usually temporary — trying again is the first thing worth
        doing.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Button onClick={reset}>
          <RotateCcw className="size-4" strokeWidth={1.75} aria-hidden />
          Try again
        </Button>
        <Link href={backHref} className={buttonVariants({ variant: 'secondary' })}>
          {backLabel}
        </Link>
      </div>
      {error.digest && (
        <p className="mt-5 font-mono text-micro text-ink-ghost">Reference {error.digest}</p>
      )}
    </Card>
  );
}
