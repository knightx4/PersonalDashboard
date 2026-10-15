'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { DashAction } from '@/components/ui/dash-action';
import { writeQuestions, type WriteQuestionsState } from './actions';

/**
 * The press that turns the material into questions.
 *
 * Separate from picking the material on purpose: choosing three notes and
 * changing your mind costs nothing, and the one call this makes happens when
 * somebody asks for it rather than on the way past.
 */

function WriteButton({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <DashAction
      type="submit"
      pending={pending}
      paid="app/learn/quiz/[id]/actions.ts#writeQuestions"
      what="Cost of writing the questions"
    >
      {pending ? 'Reading the material…' : `Write ${count} questions`}
    </DashAction>
  );
}

export function WriteQuestions({ quizId, count }: { quizId: string; count: number }) {
  const [state, formAction] = useActionState<WriteQuestionsState, FormData>(writeQuestions, {});

  return (
    <form action={formAction} className="mt-4">
      <input type="hidden" name="quizId" value={quizId} />

      <div className="flex flex-wrap items-center gap-3">
        <WriteButton count={count} />
        {state.error && <span className="text-ui text-danger">{state.error}</span>}
        {/* Not an error: material with nothing answerable in it is a normal
            thing to have picked, and the sentence says which piece it was. */}
        {state.message && <span className="text-ui text-ink-muted">{state.message}</span>}
      </div>
    </form>
  );
}
