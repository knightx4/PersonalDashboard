'use client';

import Link from '@/components/ui/link';
import { LinkedText } from '@/components/ui/linked-text';
import { StatusGlyph } from '@/components/ui/status-glyph';
import { exactTime, shortWhen } from '@/lib/comments/when';
import type { RunQuestion } from '@/lib/core/run-questions';
import { useClockNow } from '@/lib/use-clock-now';
import { RunAnswer, type AnswerRunAction } from './run-answer';

/**
 * A question a run asked partway and is waiting on, as a row of an inbox
 * (plan #1824): what the run is on first, linking to the run's lines, then
 * that it is waiting and since when, the question, and its choices as
 * presses that answer it. Drawn the same in the Dev inbox and the Goals
 * inbox; the action is the runs table's own.
 */
export function RunQuestionCard({
  question,
  action,
}: {
  question: RunQuestion;
  action: AnswerRunAction;
}) {
  const now = useClockNow();

  return (
    <li className="card-pad-x row-pad min-w-0 space-y-1">
      <Link
        href={question.href}
        className="press-area block text-ui font-semibold break-words text-ink underline-offset-2 hover:underline"
      >
        {question.about}
      </Link>
      <p className="flex flex-wrap items-center gap-x-1.5 text-small text-ink-muted">
        <StatusGlyph glyph="question" size={14} />
        <span>Dash is waiting on your answer</span>
        <time dateTime={question.askedAt} title={exactTime(question.askedAt)} className="tabular text-ink-ghost">
          {shortWhen(question.askedAt, now)}
        </time>
      </p>
      <p className="text-ui break-words whitespace-pre-wrap text-ink">
        {question.body ? (
          <LinkedText text={question.body} />
        ) : (
          'Its question was not written down. Open the run to see where it stopped.'
        )}
      </p>
      <RunAnswer runId={question.runId} options={question.options} action={action} />
    </li>
  );
}
