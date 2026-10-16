'use client';

import { useFormStatus } from 'react-dom';
import { cardVariants } from '@/components/ui/card';
import { DashAction } from '@/components/ui/dash-action';
import { Field, Textarea } from '@/components/ui/field';
import { LinkedText } from '@/components/ui/linked-text';
import { PaidHint } from '@/components/ui/paid-hint';
import { AskButton, EndHereButton, NotNowButton } from './buttons';
import { ForwardRow } from './explain-card';
import type { FlowState } from './state';

/**
 * A worked case in Practice Flow (plan #2164.3): figures and a task on one of
 * a goal's ideas, answered with a number or two sentences and graded as the
 * applied rung is. After the answer the card shows what you wrote, Dash's
 * sentence and the answer the case was written with, then Next.
 *
 * Like the explain card it is one item of a deck, so its presses sit in one
 * row at the foot of the card, held above the tab bar on a phone: Check my
 * answer and Later before the answer, Next and End here after it.
 *
 * `grading` is for the gallery alone: it holds the press in its pending state.
 */
export function CaseCard({
  live,
  step,
  fields,
  grading,
  onEnd,
}: {
  live: FlowState;
  step: (formData: FormData) => void;
  /** The flow's focus fields, carried by every form. */
  fields: React.ReactNode;
  grading?: boolean;
  /** End here (plan #2164.6). Unset draws no such press. */
  onEnd?: () => void;
}) {
  const answered = live.answered;
  return (
    <form action={step} className={cardVariants({ padding: 'standard' })}>
      {fields}
      <input type="hidden" name="intent" value={answered ? 'ask' : 'answer'} />
      <input type="hidden" name="probeId" value={live.probeId} />
      <input type="hidden" name="conceptId" value={live.conceptId} />
      <input type="hidden" name="subjectId" value={live.subjectId} />

      <p className="text-small text-ink-muted">
        {live.goal
          ? `${live.subjectName} · from your learning goals`
          : [live.conceptName, live.subjectName].filter(Boolean).join(' · ')}
      </p>
      <p className="mt-1 whitespace-pre-line text-body text-ink">
        <LinkedText text={live.question ?? ''} />
      </p>

      {!answered ? (
        <>
          <Field
            id={`case-${live.probeId}`}
            label="Your answer"
            hint="A number, or a sentence or two. It is marked on whether the idea is right rather than on the wording."
            className="mt-4"
          >
            {/* ui-ok: composer-always-open -- the question is the screen. */}
            <Textarea
              id={`case-${live.probeId}`}
              name="response"
              rows={3}
              maxLength={2000}
              required
              autoFocus
            />
          </Field>
          {live.error && (
            <p role="alert" className="mt-3 text-ui text-danger">
              {live.error}
            </p>
          )}
          <ForwardRow>
            <CheckButton forced={grading} />
            <WhileIdle forced={grading}>
              <span className="inline-flex items-center gap-1">
                <NotNowButton />
                {/* dash-action-ok: the hint sits beside the Later close button, which does not run the model. */}
                <PaidHint action="app/learn/flow/actions.ts#flowStep:ask" what="Cost of the next question" />
              </span>
            </WhileIdle>
          </ForwardRow>
        </>
      ) : (
        <div className="mt-4 border-t border-border pt-4">
          {answered.response && (
            <div className="mb-3">
              <p className="text-small text-ink-muted">You wrote</p>
              <p className="mt-0.5 whitespace-pre-line text-ui voice-you">
                <LinkedText text={answered.response} refs={false} />
              </p>
            </div>
          )}
          <div className="voice-dash px-3 py-2">
            <p className="text-ui font-semibold">{answered.correct ? 'Right.' : 'Not this time.'}</p>
            <p className="mt-1 text-ui">{answered.reason}</p>
          </div>
          {answered.expected && (
            <div className="mt-3">
              <p className="text-small text-ink-muted">The answer expected</p>
              <p className="mt-0.5 text-ui text-ink">{answered.expected}</p>
            </div>
          )}
          {live.error && (
            <p role="alert" className="mt-3 text-ui text-danger">
              {live.error}
            </p>
          )}
          <ForwardRow>
            <AskButton label="Next" />
            {onEnd && <EndHereButton onEnd={onEnd} />}
          </ForwardRow>
        </div>
      )}
    </form>
  );
}

/** Put away while Dash marks: nothing else can be done then. */
function WhileIdle({ forced, children }: { forced?: boolean; children: React.ReactNode }) {
  const { pending } = useFormStatus();
  if (forced || pending) return null;
  return <>{children}</>;
}

/** Check my answer: the press that sends what was written to be marked. */
function CheckButton({ forced }: { forced?: boolean }) {
  const { pending: submitting } = useFormStatus();
  const pending = forced || submitting;
  return (
    <DashAction
      type="submit"
      pending={pending}
      paid="app/learn/flow/actions.ts#flowStep:answer"
      what="Cost of marking the answer"
    >
      {pending ? 'Marking…' : 'Check my answer'}
    </DashAction>
  );
}
