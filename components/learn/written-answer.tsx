'use client';

import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { DashAction } from '@/components/ui/dash-action';
import { Field, Textarea } from '@/components/ui/field';
import type { PaidAction } from '@/lib/core/spend/paid-actions';

/**
 * The box an applied case is answered in.
 *
 * Beside ProbeOptions, and the same shape of thing: it sits inside the form
 * the session already has, carries the answer under its own name, and is
 * submitted by pressing rather than by a separate control. The difference is
 * what the answer is -- a sentence or two typed from memory rather than one of
 * four options -- which is the whole of what the applied rung asks for.
 *
 * Once it has been answered the box stays on screen with what was written in
 * it, disabled. Reading the grade against your own words is where the work
 * happens, and a box that emptied itself would take that away.
 */

function GradeButton({ paid }: { paid?: PaidAction }) {
  const { pending } = useFormStatus();
  return (
    <DashAction type="submit" pending={pending} paid={paid} what="Cost of marking the answer">
      {pending ? 'Marking…' : 'Check my answer'}
    </DashAction>
  );
}

export function WrittenAnswer({
  response,
  paid,
  beside,
}: {
  response?: string | null;
  /** The server action that marks the answer, for the cost beside the button. */
  paid?: PaidAction;
  /** Anything else that can be done with this case, shown next to Answer. */
  beside?: ReactNode;
}) {
  const answered = typeof response === 'string';

  return (
    <>
      <Field
        label="Your answer"
        id="response"
        hint="A sentence or two, in your own words. It is marked on whether the idea is right rather than on the wording."
      >
        {/* ui-ok: composer-always-open -- the question is the screen. There is
          * nothing listed above this box for it to be standing open in front
          * of. Same call as the quiz's question form. */}
        <Textarea
          id="response"
          name="response"
          rows={3}
          maxLength={2000}
          required
          defaultValue={response ?? ''}
          disabled={answered}
          autoFocus={!answered}
        />
      </Field>

      {!answered && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <GradeButton paid={paid} />
          {beside}
        </div>
      )}
    </>
  );
}
