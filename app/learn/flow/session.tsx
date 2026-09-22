'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { ProbeOptions } from '@/components/learn/probe-options';
import { flowStep, type FlowState } from './actions';

/**
 * Start, a question, the reason, and Next, for as long as you keep going.
 *
 * Asking and answering share one action state, so the question on screen is
 * always the one the last submit returned. Next runs the pick again rather
 * than working through a list, which is what lets an answer that just settled
 * a claim change what is asked after it. It stops only when the pick has
 * nothing left.
 */

const NOTHING_TO_ASK: Record<NonNullable<FlowState['nothing']>, string> = {
  'no-subjects': 'No subjects yet, so there is nothing to ask about. Name one first.',
  'all-settled': 'Every claim in every subject is settled. Nothing left to ask.',
};

function AskButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Writing a question…' : label}
    </Button>
  );
}

export function FlowSession() {
  const [live, step] = useActionState<FlowState, FormData>(flowStep, {});

  if (!live.question || !live.options) {
    return (
      <form action={step} className={cn(cardVariants(), 'border-dashed px-4 py-6 text-center')}>
        <input type="hidden" name="intent" value="ask" />
        <p className="text-body text-ink-muted">
          Questions about what you are ready for next, across everything you are learning. Answer
          as many as you like and stop whenever you want.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          {!live.nothing && <AskButton label="Start" />}
          {live.nothing && <span className="text-ui text-ink-muted">{NOTHING_TO_ASK[live.nothing]}</span>}
          {live.error && <span className="text-ui text-danger">{live.error}</span>}
        </div>
      </form>
    );
  }

  return (
    <div className={cardVariants({ padding: 'standard' })}>
      <p className="text-small text-ink-muted">
        {live.conceptName}
        {live.subjectName && ` · ${live.subjectName}`}
      </p>
      {/* Said before the question rather than after the answer: being asked
          about something you settled months ago looks like the app having lost
          track until you know it is deliberate. Which of the two settled it is
          said as well, because a claim you only waved through has never been
          asked about at all and the question will read differently for it. */}
      {live.recheck && (
        <p className="mt-0.5 text-small text-ink-muted">
          {live.recheck === 'declared'
            ? 'A re-check — you said you knew this one a while ago.'
            : 'A re-check — you answered about this one a while ago.'}
        </p>
      )}
      <p className="mt-1 text-body text-ink">{live.question}</p>

      <form action={step} className="mt-4 space-y-2">
        <input type="hidden" name="intent" value="answer" />
        <input type="hidden" name="probeId" value={live.probeId} />
        <input type="hidden" name="conceptId" value={live.conceptId} />
        <input type="hidden" name="subjectId" value={live.subjectId} />

        <ProbeOptions options={live.options} answered={live.answered ?? null} />
      </form>

      {live.answered && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-ui font-semibold text-ink">
            {live.answered.correct ? 'Right.' : 'Not this time.'}
          </p>
          {/* Written when the question was, not in response to what was
              picked. That is what makes it worth reading. */}
          <p className="mt-1 text-body text-ink">{live.answered.reason}</p>

          {live.answered.misconception && (
            <p className="mt-3 border-l-2 border-danger pl-3 text-body text-ink">
              You have picked this one twice now. {live.answered.misconception}
            </p>
          )}

          <form action={step} className="mt-4">
            <input type="hidden" name="intent" value="ask" />
            <AskButton label="Next" />
          </form>
        </div>
      )}

      {live.error && <p className="mt-3 text-ui text-danger">{live.error}</p>}
    </div>
  );
}
