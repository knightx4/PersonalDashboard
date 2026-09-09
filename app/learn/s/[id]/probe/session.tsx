'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { answerQuestion, askQuestion, type AskState } from './actions';

/**
 * One question at a time, and the truth about how far along you are.
 *
 * The bar measures information gained rather than questions answered, so it
 * moves a long way early and barely at all later, and it never reaches 100%.
 * That is the honest shape: nothing here can establish that somebody knows a
 * subject, and a bar that filled would be saying it had.
 *
 * The reason is shown after answering, never before, and it was written at the
 * same time as the question rather than generated in response to what was
 * picked -- which is what stops it being an explanation of the answer somebody
 * happened to give.
 */

function Bar({ percent }: { percent: number }) {
  return (
    <div className="mb-5">
      <div
        className="h-1.5 w-full overflow-hidden rounded-pill bg-canvas"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="How much this has learned about you"
      >
        <div className="h-full rounded-pill bg-accent transition-all" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 text-small text-ink-muted">
        {percent === 0
          ? 'Nothing answered yet.'
          : `${percent}% of what this can find out — it measures what has been learned about you, not how many questions you have answered.`}
      </p>
    </div>
  );
}

function AskButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      {pending ? 'Writing a question…' : label}
    </Button>
  );
}

function AnswerButton({ index, label, disabled }: { index: number; label: string; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="chosenIndex"
      value={index}
      disabled={pending || disabled}
      className={cn(
        'w-full rounded-control border border-border px-4 py-3 text-left text-body text-ink',
        'hover:border-accent hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-70',
      )}
    >
      {label}
    </button>
  );
}

export function ProbeSession({ subjectId, startingPercent }: { subjectId: string; startingPercent: number }) {
  const [state, ask] = useActionState<AskState, FormData>(askQuestion, { percent: startingPercent });
  const [answerState, answer] = useActionState<AskState, FormData>(answerQuestion, state);

  // The answer action carries the question forward, so whichever ran last is
  // the live one.
  const live = answerState.answered ? answerState : state;
  const percent = live.percent ?? startingPercent;

  return (
    <>
      <Bar percent={percent} />

      {live.question && live.options ? (
        <div className={cardVariants({ padding: 'standard' })}>
          <p className="text-small text-ink-muted">{live.conceptName}</p>
          <p className="mt-1 text-body text-ink">{live.question}</p>

          <form action={answer} className="mt-4 space-y-2">
            <input type="hidden" name="probeId" value={live.probeId} />
            <input type="hidden" name="conceptId" value={live.conceptId} />
            <input type="hidden" name="subjectId" value={subjectId} />

            {live.options.map((option, index) => (
              <div key={option} className="relative">
                <AnswerButton index={index} label={option} disabled={Boolean(live.answered)} />
                {live.answered && index === live.answered.correctIndex && (
                  <Check
                    className="absolute right-3 top-3.5 size-4 text-ink-muted"
                    strokeWidth={2}
                    aria-label="The correct answer"
                  />
                )}
                {live.answered &&
                  index === live.answered.chosenIndex &&
                  index !== live.answered.correctIndex && (
                    <X
                      className="absolute right-3 top-3.5 size-4 text-danger"
                      strokeWidth={2}
                      aria-label="What you picked"
                    />
                  )}
              </div>
            ))}
          </form>

          {live.answered && (
            <div className="mt-4 border-t border-border pt-4">
              <p className="text-ui font-semibold text-ink">
                {live.answered.correct ? 'Right.' : 'Not this time.'}
              </p>
              {/* Written when the question was, not in response to what was
                  picked. That is what makes it worth reading. */}
              <p className="mt-1 text-body text-ink">{live.answered.reason}</p>

              <form action={ask} className="mt-4">
                <input type="hidden" name="subjectId" value={subjectId} />
                <AskButton label="Another one" />
              </form>
            </div>
          )}

          {live.error && <p className="mt-3 text-ui text-danger">{live.error}</p>}
        </div>
      ) : (
        <form action={ask} className={cn(cardVariants(), 'border-dashed px-4 py-6 text-center')}>
          <input type="hidden" name="subjectId" value={subjectId} />
          <p className="text-body text-ink-muted">
            One question at a time, written against one claim in this subject. Ten is a good start,
            and then as many as you want.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <AskButton label="Start" />
            {live.error && <span className="text-ui text-danger">{live.error}</span>}
          </div>
        </form>
      )}
    </>
  );
}
