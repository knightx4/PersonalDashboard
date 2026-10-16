'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { DashAction } from '@/components/ui/dash-action';
import { Textarea } from '@/components/ui/field';
import { answerExternal, skipExternal, type SitState } from './actions';

function AnswerButton() {
  const { pending } = useFormStatus();
  return (
    <DashAction
      type="submit"
      pending={pending}
      paid="app/learn/settings/external/actions.ts#answerExternal"
      what="Cost of marking the answer"
    >
      {pending ? 'Marking…' : 'Answer'}
    </DashAction>
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

/**
 * One item of the set. Neither press shows how it was marked: the page
 * re-renders on the next item, or on the score after the last.
 */
export function ItemForm({ checkId }: { checkId: string }) {
  const [state, answer] = useActionState<SitState, FormData>(answerExternal, {});
  const [passed, skip] = useActionState<SitState, FormData>(skipExternal, {});

  return (
    <form action={answer} className="mt-4">
      <input type="hidden" name="checkId" value={checkId} />
      {/* ui-ok: composer-always-open -- the question is the screen; nothing is listed above this box. */}
      <Textarea
        id="response"
        name="response"
        rows={3}
        maxLength={2000}
        autoFocus
        className="text-ui"
        aria-label="Your answer"
        placeholder="Your answer, from memory"
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <AnswerButton />
        <SkipButton formAction={skip} />
        {(state.error || passed.error) && (
          <span className="text-ui text-danger">{state.error ?? passed.error}</span>
        )}
      </div>
    </form>
  );
}
