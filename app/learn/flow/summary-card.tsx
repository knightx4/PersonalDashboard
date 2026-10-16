'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { summaryHeadline, type RunSummary } from '@/lib/learn/flow/summary';
import { readRunSummary } from './summary-action';

/**
 * What a session moved (plan #2164.6, `lib/learn/flow/summary.ts`): the card
 * that ends a Practice Flow run and today's piece. It says what the answers
 * of the last hour showed, what they missed and what that put on the fringe,
 * with a line quoted from each answer, and it is read from the stored
 * answers alone.
 */

function Quote({ text }: { text: string }) {
  return <p className="mt-0.5 border-l-2 border-border pl-3 text-ui text-ink-muted">&ldquo;{text}&rdquo;</p>;
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-5 text-small font-medium text-ink-muted">{children}</h3>;
}

function More({ count }: { count: number }) {
  return count > 0 ? <li className="text-small text-ink-muted">and {count} more</li> : null;
}

/** The card itself, from a summary. The gallery draws this from fixtures. */
export function SummaryView({ summary, foot }: { summary: RunSummary; foot?: ReactNode }) {
  return (
    <Card padding="standard" aria-live="polite">
      <h2 className="font-display text-title tracking-tight text-ink">What moved</h2>
      <p className="mt-0.5 text-ui text-ink-muted">{summaryHeadline(summary)}</p>

      {summary.shown.length > 0 && (
        <>
          <Heading>You showed</Heading>
          <ul className="mt-1.5 space-y-3">
            {summary.shown.map((row) => (
              <li key={row.name}>
                <p className="text-body text-ink">{row.name}</p>
                {row.quote && <Quote text={row.quote} />}
              </li>
            ))}
            <More count={summary.more.shown} />
          </ul>
        </>
      )}

      {summary.missed.length > 0 && (
        <>
          <Heading>You missed</Heading>
          <ul className="mt-1.5 space-y-3">
            {summary.missed.map((row) => (
              <li key={row.name}>
                <p className="text-body text-ink">{row.name}</p>
                {row.quote && <Quote text={row.quote} />}
                {row.why && (
                  <p className="mt-2 text-small text-ink-muted">
                    <span className="font-medium text-ink">Dash: </span>
                    {row.why}
                  </p>
                )}
              </li>
            ))}
            <More count={summary.more.missed} />
          </ul>
        </>
      )}

      {summary.fringe.length > 0 && (
        <>
          <Heading>That opened</Heading>
          <ul className="mt-1.5 space-y-1">
            {summary.fringe.map((name) => (
              <li key={name} className="text-body text-ink">
                {name}
              </li>
            ))}
            <More count={summary.more.fringe} />
          </ul>
        </>
      )}

      {/* The one way on, held above the tab bar on a phone as the deck's forward row is. */}
      {foot && (
        <div className="sticky bottom-[calc(var(--dock-h)+env(safe-area-inset-bottom))] z-over-link -mx-(--card-p) mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 bg-surface px-(--card-p) py-2 lg:static">
          {foot}
        </div>
      )}
    </Card>
  );
}

/**
 * Reads the summary on mount and draws it: a skeleton while it reads, a line
 * when nothing was answered in the hour, and the reason when the read failed.
 */
export function RunSummaryPanel({ foot }: { foot?: ReactNode }) {
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'ready'; summary: RunSummary | null; error?: string }
  >({ kind: 'loading' });

  useEffect(() => {
    let live = true;
    void readRunSummary()
      .catch(() => ({ summary: null, error: 'Could not read your answers. Check your connection.' }))
      .then((result) => {
        if (live) setState({ kind: 'ready', ...result });
      });
    return () => {
      live = false;
    };
  }, []);

  if (state.kind === 'loading') {
    return (
      <Card padding="standard" aria-busy="true" aria-label="Reading what moved">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="mt-2 h-3.5 w-56" />
        <Skeleton className="mt-5 h-3.5 w-3/4" />
        <Skeleton className="mt-2 h-3.5 w-1/2" />
      </Card>
    );
  }
  if (state.error) {
    return (
      <p className="text-ui text-danger" role="alert">
        {state.error}
      </p>
    );
  }
  if (!state.summary) {
    return <p className="text-ui text-ink-muted">Nothing was answered in the last hour.</p>;
  }
  return <SummaryView summary={state.summary} foot={foot} />;
}
