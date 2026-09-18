'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/field';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { answerOpening, skipOpening, type AnswerState } from './actions';

/**
 * One question, answered from memory or passed over.
 *
 * Written rather than picked from a list, which is the whole reason the sweep
 * is worth anything: on a subject nobody has studied, choosing the right
 * answer out of four is a quarter guess, and what this is measuring is what
 * somebody can actually produce before they have read anything.
 *
 * So the box is empty and the way out is beside it. Most answers will be
 * wrong, and the screen says so rather than letting somebody think they are
 * failing something.
 */

function AnswerButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Checking…' : 'Answer'}
    </Button>
  );
}

function SkipButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="ghost" disabled={pending}>
      {pending ? 'Passing…' : 'I do not know'}
    </Button>
  );
}

export function QuestionForm({
  sweepId,
  questionId,
  question,
  position,
  total,
  left,
}: {
  sweepId: string;
  questionId: string;
  question: string;
  position: number;
  total: number;
  left: number;
}) {
  const [state, answer] = useActionState<AnswerState, FormData>(answerOpening, {});
  const [skipState, skip] = useActionState<AnswerState, FormData>(skipOpening, {});

  return (
    <div className={cn(cardVariants({ padding: 'standard' }), 'mt-6')}>
      <p className="text-small text-ink-muted">
        Question {position} of {total} · {left} left
      </p>

      <p className="mt-2 text-body text-ink">{question}</p>

      <form action={answer} className="mt-4">
        <input type="hidden" name="sweepId" value={sweepId} />
        <input type="hidden" name="questionId" value={questionId} />

        <Field
          label="Your answer"
          id="response"
          hint="From memory, in a sentence. Being wrong here is the ordinary case and it is what makes the rest of this work."
        >
          <Textarea id="response" name="response" rows={3} maxLength={2000} autoFocus />
        </Field>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <AnswerButton />
          {state.error && <span className="text-ui text-danger">{state.error}</span>}
        </div>
      </form>

      {/* Its own form, so passing does not have to get past the answer box
          being empty. Every question is passable -- that is what keeps ten of
          these survivable on the screen where somebody is least committed. */}
      <form action={skip} className="mt-2">
        <input type="hidden" name="sweepId" value={sweepId} />
        <input type="hidden" name="questionId" value={questionId} />
        <SkipButton />
        {skipState.error && <span className="ml-3 text-ui text-danger">{skipState.error}</span>}
      </form>
    </div>
  );
}
