'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { ProbeOptions } from '@/components/learn/probe-options';
import { answerTodayQuestion, askTodayQuestion, type TodayState } from './actions';

/**
 * Start, one question, the reason, and then nothing.
 *
 * There is no button for another question, and that is the whole shape of the
 * thing: a session that offers one more is a session you have to decide to
 * stop. Carrying on means opening the subject the claim came from, which is a
 * link rather than a button because it is leaving rather than continuing.
 */

const NOTHING_TO_ASK: Record<NonNullable<TodayState['nothing']>, string> = {
  'no-subjects': 'No subjects yet, so there is nothing to ask about. Name one first.',
  'all-settled': 'Every claim in every subject is settled. Nothing to ask about today.',
};

function StartButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Writing a question…' : 'Start'}
    </Button>
  );
}

export function TodaySession() {
  const [state, ask] = useActionState<TodayState, FormData>(askTodayQuestion, {});
  const [answerState, answer] = useActionState<TodayState, FormData>(answerTodayQuestion, state);

  // The answer action carries the question forward, so whichever ran last is
  // the live one.
  const live = answerState.answered ? answerState : state;

  if (!live.question || !live.options) {
    return (
      <form action={ask} className={cn(cardVariants(), 'border-dashed px-4 py-6 text-center')}>
        <p className="text-body text-ink-muted">
          One question about the one thing you are ready for next, across everything you are
          learning. You do not pick the subject, and there is only the one question.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <StartButton />
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

      <form action={answer} className="mt-4 space-y-2">
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

          <p className="mt-4 text-ui text-ink-muted">
            That is it for now.{' '}
            {live.subjectId && (
              <Link
                href={`/learn/s/${live.subjectId}/probe`}
                className="underline underline-offset-2 hover:text-ink"
              >
                Keep going in {live.subjectName ?? 'this subject'}
              </Link>
            )}
          </p>
        </div>
      )}

      {live.error && <p className="mt-3 text-ui text-danger">{live.error}</p>}
    </div>
  );
}
