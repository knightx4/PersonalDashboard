import Link, { linkVariants } from '@/components/ui/link';
import { Card } from '@/components/ui/card';
import { DashMark } from '@/components/ui/dash-mark';
import { SectionLabel } from '@/components/ui/section-heading';
import { cn } from '@/lib/cn';
import type { QuestionResult } from '@/lib/goals/dash-work';
import { firstSentence } from '@/lib/goals/first-sentence';
import type { Suggestion } from '@/lib/goals/suggestions';
import { workAnchor } from '@/lib/goals/take-on';
import { SuggestionRow } from './goal-suggestions';

/** The answer's opening paragraph: what the run wrote before its first blank line. */
function opening(text: string | null): string | null {
  if (!text) return null;
  const para = text.trim().split(/\n\s*\n/)[0]?.replace(/[#*_`>]/g, '').trim();
  return para || null;
}

/**
 * What Dash worked out for a question handed to the goal (plan #2778.8), at
 * the top of the Dashboard: what was asked, the answer's opening paragraph
 * with the way to the whole of it, and the steps and tiles it suggests, each
 * waiting on Add and No. The notification and the reply line in Ask Dash link
 * here, to the card's anchor.
 */
export function QuestionResults({
  goalId,
  results,
  suggestions,
  named,
}: {
  goalId: string;
  results: readonly QuestionResult[];
  /** What the runs suggested and nobody has answered, by run id. */
  suggestions: Readonly<Record<string, readonly Suggestion[]>>;
  /** The run the link opened the page at, marked with the accent edge when there are several. */
  named?: string | null;
}) {
  if (results.length === 0) return null;
  return (
    <Card padding="none" className="divide-y divide-border">
      {results.map((result) => {
        const suggested = suggestions[result.runId] ?? [];
        const answer = result.state === 'done' ? opening(result.text) : null;
        return (
          <section
            key={result.runId}
            id={workAnchor(result.runId)}
            aria-labelledby={`${workAnchor(result.runId)}-q`}
            className={cn(
              'scroll-mt-20',
              result.runId === named && results.length > 1 && 'border-l-2 border-l-accent',
            )}
          >
            <div className="card-pad-x space-y-2 pt-3 pb-3">
              <SectionLabel as="p" className="inline-flex items-center gap-1.5">
                <DashMark size="2xs" tone="brand" decorative />
                {result.state === 'done' ? 'Dash worked out' : 'Dash could not finish'}
              </SectionLabel>
              <h2
                id={`${workAnchor(result.runId)}-q`}
                className="text-ui font-semibold text-ink [overflow-wrap:anywhere]"
              >
                {result.question}
              </h2>
              {result.state === 'done' ? (
                <p className="max-w-prose text-body text-ink [overflow-wrap:anywhere]">
                  {answer ?? 'The answer is in the run’s details.'}
                </p>
              ) : (
                <p className="text-small text-ink-muted">
                  {firstSentence(result.text) || 'The run stopped before it had an answer.'}
                </p>
              )}
              <Link
                href={`/goals/runs/${result.runId}`}
                className={cn('press-area text-small', linkVariants())}
              >
                {result.state === 'done' ? 'The whole answer' : 'What it got to'}
              </Link>
            </div>
            {suggested.length > 0 && (
              <div className="border-t border-border">
                <p className="card-pad-x pt-3 text-small font-medium text-ink-muted">
                  {suggested.length === 1 ? 'It suggests one change' : `It suggests ${suggested.length} changes`}
                </p>
                <ul className="divide-y divide-border">
                  {suggested.map((s) => (
                    <SuggestionRow key={s.id} goalId={goalId} suggestion={s} />
                  ))}
                </ul>
              </div>
            )}
          </section>
        );
      })}
    </Card>
  );
}
