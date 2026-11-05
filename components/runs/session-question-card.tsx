'use client';

import Link, { linkVariants } from '@/components/ui/link';
import { LinkedText } from '@/components/ui/linked-text';
import { StatusGlyph } from '@/components/ui/status-glyph';
import { exactTime, shortWhen } from '@/lib/comments/when';
import type { SessionQuestion } from '@/lib/core/session-questions';
import { useClockNow } from '@/lib/use-clock-now';
import { RunAnswer, type AnswerRunAction } from './run-answer';

/**
 * A question a session stopped to ask, as a row of the Goals inbox (plan
 * #2800.4): what the session is on first, linking to its work, that it is
 * waiting and since when, the question, and its choices as presses that
 * answer it. Drawn like a run's question (run-question-card.tsx). A session
 * that left no way back is listed with the question and says where to
 * answer instead of offering a box that would reach nothing.
 */
export function SessionQuestionCard({
  question,
  action,
}: {
  question: SessionQuestion;
  action: AnswerRunAction;
}) {
  const now = useClockNow();

  return (
    <li className="card-pad-x row-pad min-w-0 space-y-1">
      <Link
        href={question.href}
        className="press-area block text-ui font-semibold break-words text-ink transition-colors duration-quick hover:text-accent"
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
        <LinkedText text={question.body} />
      </p>
      {question.route === 'none' ? (
        <p className="text-small text-ink-muted">
          <Link href={question.href} className={linkVariants({ tone: 'quiet' })}>
            Open its work
          </Link>{' '}
          to answer. This session cannot be reached from here.
        </p>
      ) : (
        <RunAnswer runId={question.id} options={question.options} action={action} />
      )}
    </li>
  );
}
