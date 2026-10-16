'use client';

import { cardVariants } from '@/components/ui/card';
import { LinkedText } from '@/components/ui/linked-text';
import { PaidHint } from '@/components/ui/paid-hint';
import { WrittenAnswer } from '@/components/learn/written-answer';
import { AskButton, EndHereButton, NotNowButton } from './buttons';
import type { FlowState } from './state';

/**
 * A worked case in Practice Flow (plan #2164.3): figures and a task on one of
 * a goal's ideas, answered with a number or two sentences and graded as the
 * applied rung is. After the answer the card shows Dash's sentence and the
 * answer the case was written with, then Next.
 */
export function CaseCard({
  live,
  step,
  fields,
  onEnd,
}: {
  live: FlowState;
  step: (formData: FormData) => void;
  /** The flow's focus fields, carried by every form. */
  fields: React.ReactNode;
  /** End here (plan #2164.6). Unset draws no such press. */
  onEnd?: () => void;
}) {
  const answered = live.answered;
  return (
    <div className={cardVariants({ padding: 'standard' })}>
      <p className="text-small text-ink-muted">
        {live.conceptName}
        {live.subjectName && ` · ${live.subjectName}`}
      </p>
      {live.goal && <p className="mt-0.5 text-small text-ink-muted">From your learning goals.</p>}
      <p className="mt-1 whitespace-pre-line text-body text-ink">
        <LinkedText text={live.question ?? ''} />
      </p>

      <form action={step} className="mt-4 space-y-2">
        <input type="hidden" name="intent" value="answer" />
        {fields}
        <input type="hidden" name="probeId" value={live.probeId} />
        <input type="hidden" name="conceptId" value={live.conceptId} />
        <input type="hidden" name="subjectId" value={live.subjectId} />

        <WrittenAnswer
          response={answered?.response ?? null}
          paid="app/learn/flow/actions.ts#flowStep:answer"
          beside={
            <span className="inline-flex items-center gap-1">
              <NotNowButton />
              {/* dash-action-ok: the hint sits beside the Later close button, which does not run the model. */}
              <PaidHint action="app/learn/flow/actions.ts#flowStep:ask" what="Cost of the next question" />
            </span>
          }
        />
      </form>

      {answered && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-ui font-semibold text-ink">
            {answered.correct ? 'Right.' : 'Not this time.'}
          </p>
          <p className="mt-1 text-body text-ink">{answered.reason}</p>
          {answered.expected && (
            <>
              <p className="mt-3 text-small text-ink-muted">The answer expected</p>
              <p className="mt-0.5 text-body text-ink">{answered.expected}</p>
            </>
          )}
          <form action={step} className="mt-4">
            <input type="hidden" name="intent" value="ask" />
            {fields}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <AskButton label="Next" />
              {onEnd && <EndHereButton onEnd={onEnd} />}
            </div>
          </form>
        </div>
      )}

      {live.error && <p className="mt-3 text-ui text-danger">{live.error}</p>}
    </div>
  );
}
