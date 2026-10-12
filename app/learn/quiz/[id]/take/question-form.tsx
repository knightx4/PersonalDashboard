'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { PaidHint } from '@/components/ui/paid-hint';
import { Textarea } from '@/components/ui/field';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { answerQuiz, skipQuiz, type AnswerState } from './actions';

/**
 * One question, answered in your own words or passed over.
 *
 * The mark and the answer the material expected are shown before the next
 * question arrives, which is the part of this worth getting right: finding out
 * you were wrong and reading what was expected is where the work happens, and
 * a screen that moved straight on would skip it.
 *
 * So neither action revalidates. Moving on is the press below the mark, and
 * that is what asks the server for the next question.
 */

const MARK = {
  right: 'Right',
  wrong: 'Not quite',
  skipped: 'Passed',
} as const;

function AnswerButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" pending={pending}>
      {pending ? 'Marking…' : 'Answer'}
    </Button>
  );
}

function SkipButton({ formAction }: { formAction: (formData: FormData) => void }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="ghost" formAction={formAction} pending={pending}>
      {pending ? 'Passing…' : 'I do not know'}
    </Button>
  );
}

export function QuestionForm({
  quizId,
  questionId,
  question,
  position,
  total,
  left,
  intro,
}: {
  quizId: string;
  questionId: string;
  question: string;
  position: number;
  total: number;
  left: number;
  intro: string;
}) {
  const router = useRouter();
  const [state, answer] = useActionState<AnswerState, FormData>(answerQuiz, {});
  const [passed, skip] = useActionState<AnswerState, FormData>(skipQuiz, {});

  const verdict = state.verdict ?? passed.verdict;

  return (
    <div className={cn(cardVariants({ padding: 'standard' }), 'mt-6')}>
      <p className="text-small text-ink-muted">{intro}</p>
      <p className="mt-3 text-small text-ink-muted">
        Question {position} of {total} · {left} left
      </p>

      <p className="mt-2 text-body text-ink">{question}</p>

      {verdict ? (
        <div className="mt-4">
          <p
            className={cn(
              'text-ui font-medium',
              verdict.outcome === 'right' ? 'text-positive' : 'text-ink',
            )}
          >
            {MARK[verdict.outcome]}
          </p>
          <p className="mt-1 text-small text-ink-muted">What the material said</p>
          <p className="mt-0.5 text-body text-ink">{verdict.expected}</p>

          <div className="mt-4">
            <Button
              type="button"
              onClick={() => {
                if (verdict.finished) router.push(`/learn/quiz/${quizId}`);
                else router.refresh();
              }}
            >
              {verdict.finished ? 'See how you did' : 'Next question'}
            </Button>
          </div>
        </div>
      ) : (
        <form action={answer} className="mt-4">
          <input type="hidden" name="quizId" value={quizId} />
          <input type="hidden" name="questionId" value={questionId} />

          {/* ui-ok: composer-always-open -- the question is the screen.
           * There is nothing listed above this box for it to be standing
           * open in front of. The page header says "in your own words"
           * once, so the box needs only a placeholder. */}
          <Textarea
            id="response"
            name="response"
            rows={3}
            maxLength={2000}
            autoFocus
            aria-label="Your answer"
            placeholder="Your answer, from memory"
          />

          {/* Passing sits beside Answer and submits the same form to its own
                action, so an empty box does not get in its way. Every question
                is passable: a blank is honest. */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <AnswerButton />
            <SkipButton formAction={skip} />
            <PaidHint
              action="app/learn/quiz/[id]/take/actions.ts#answerQuiz"
              what="Cost of marking the answer"
            />
            {(state.error || passed.error) && (
              <span className="text-ui text-danger">{state.error ?? passed.error}</span>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
