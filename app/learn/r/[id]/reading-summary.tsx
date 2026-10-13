'use client';

import { useState, useTransition } from 'react';
import { RotateCcw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { PaidHint } from '@/components/ui/paid-hint';
import { cn } from '@/lib/cn';
import type { ReadingSummary as Summary } from '@/lib/learn/tracks/load';
import {
  summaryCutLine,
  summaryParagraphs,
  summarySource,
  UNREADABLE_ACTION,
} from '@/lib/learn/tracks/reading-summary';
import { summarizeReading } from './actions';
import { READING_TEXT_ANCHOR, ReadingText } from './reading-text';

export type SummaryFailure = { error: string; unreadable?: boolean };

/**
 * The Summary tab of a reading (plan #1876.4): Dash's summary, the chat with
 * Dash about the reading (plan #1876.5), then the text Dash reads both from.
 *
 * The summary is kept on the reading, so a later visit shows it again with
 * what it was written from and whether Dash read only the start. Redo writes
 * a new one over it. When the link cannot be read the error says so once,
 * its last words a link to the paste and upload buttons below.
 */
export function ReadingSummary({
  readingId,
  summary: saved,
  given,
  failure: initialFailure = null,
  chat,
}: {
  readingId: string;
  summary: Summary | null;
  /** The text you gave the reading, for the section under the summary. */
  given: { label: string; addedAt: string } | null;
  /** A failed press, drawn by the gallery; the page starts with none. */
  failure?: SummaryFailure | null;
  /** The chat with Dash about the reading (plan #1876.5), drawn between the summary and the text. */
  chat?: React.ReactNode;
}) {
  const [summary, setSummary] = useState<Summary | null>(saved);
  const [failure, setFailure] = useState<SummaryFailure | null>(initialFailure);
  const [pending, start] = useTransition();

  function run() {
    setFailure(null);
    start(async () => {
      const result = await summarizeReading(readingId);
      if (result.ok) setSummary(result.summary);
      else setFailure({ error: result.error, unreadable: result.unreadable });
    });
  }

  const unreadable = failure?.unreadable === true;
  const cut = summary ? summaryCutLine(summary.truncated) : null;
  const source = summary ? summarySource(summary) : null;

  return (
    <>
      <section
        className={cn(cardVariants({ padding: 'dense' }), 'mb-5', summary ? '' : 'border-dashed')}
        aria-label="Summary"
        aria-busy={pending}
      >
        {summary && source ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-ui text-ink-muted [overflow-wrap:anywhere]">
                {source.text}
                {source.site && (
                  <>
                    {' '}
                    <a
                      href={summary.label}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-ink underline underline-offset-2 hover:text-accent"
                    >
                      {source.site}
                    </a>
                    .
                  </>
                )}
              </p>
              {cut && <p className="text-ui text-caution">{cut}</p>}
            </div>
            <div className={cn('space-y-2', pending && 'opacity-60')}>
              {summaryParagraphs(summary.text).map((paragraph, index) => (
                <p key={index} className="text-body text-ink">
                  {paragraph}
                </p>
              ))}
            </div>
            {failure && <Failure failure={failure} />}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <div className="flex items-center gap-1">
                <Button type="button" variant="secondary" size="md" onClick={run} disabled={pending}>
                  <RotateCcw className="size-4" strokeWidth={1.75} aria-hidden />
                  {pending ? 'Summarizing…' : 'Redo'}
                </Button>
                <PaidHint action="app/learn/r/[id]/actions.ts#summarizeReading" what="Cost of a summary" />
              </div>
              <span className="text-small text-ink-muted">Written {formatWritten(summary.writtenAt)}</span>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-body text-ink-muted">
              A short summary of this reading, written by Dash from its text and kept here.
            </p>
            {failure && <Failure failure={failure} />}
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant={unreadable ? 'secondary' : 'primary'}
                size="md"
                onClick={run}
                disabled={pending}
              >
                <Sparkles className="size-4" strokeWidth={1.75} aria-hidden />
                {pending ? 'Summarizing…' : 'Summarize'}
              </Button>
              <PaidHint action="app/learn/r/[id]/actions.ts#summarizeReading" what="Cost of a summary" />
            </div>
          </div>
        )}
      </section>

      {chat}

      <ReadingText readingId={readingId} given={given} unreadable={unreadable && !given} />
    </>
  );
}

/** The error, with the paste-or-upload words a link down to the buttons when that is the trouble. */
function Failure({ failure }: { failure: SummaryFailure }) {
  const linked = failure.unreadable && failure.error.endsWith(`${UNREADABLE_ACTION}.`);
  return (
    <p role="alert" className="text-small text-danger">
      {linked ? (
        <>
          {failure.error.slice(0, -(UNREADABLE_ACTION.length + 1))}
          <a href={`#${READING_TEXT_ANCHOR}`} className="underline underline-offset-2">
            {UNREADABLE_ACTION}
          </a>
          .
        </>
      ) : (
        failure.error
      )}
    </p>
  );
}

function formatWritten(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
