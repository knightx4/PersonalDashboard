'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { DashAction } from '@/components/ui/dash-action';
import { ComposeBox, ComposeTitle } from '@/components/ui/field';
import { proposeGoal, type ProposeState } from './actions';

/**
 * Name a goal, and Dash drafts its topic (plan #2138.4).
 *
 * This laid out a chain of claims for the claims graph until the graph moved
 * onto topics. Now it is the same press as New topic on /learn/topics: one
 * call drafts the topic's levels, and the press opens the draft to be read,
 * reworded and approved. Nothing is asked about it until then.
 *
 * A topic belongs to the one shared map, not to a subject. Named on a
 * subject's page, it also joins that subject's lens at solid (plan #2138.7),
 * so the subject's progress counts it. The unit and opening-question ids the
 * callers still pass are ignored.
 */

function AskButton() {
  const { pending } = useFormStatus();
  return (
    <DashAction
      type="submit"
      size="sm"
      variant="secondary"
      pending={pending}
      paid="app/learn/know/actions.ts#proposeGoal"
      what="Cost of drafting the topic"
      hintFirst
      wrapperClassName="ml-auto"
    >
      {pending ? 'Sending it to Dash…' : 'Draft the topic'}
    </DashAction>
  );
}

export function GoalForm({
  subjectId,
  goal,
  bare = false,
}: {
  subjectId?: string;
  unitId?: string;
  subjects?: { id: string; name: string }[];
  /** Filled in when the words were typed earlier, at the start of a sweep. */
  goal?: string;
  sweepId?: string;
  /** No card of its own: it is being drawn inside one. */
  bare?: boolean;
}) {
  const [state, propose] = useActionState<ProposeState, FormData>(proposeGoal, {});

  // Written as a question rather than filled in as a field (plan #1435).
  return (
    <form action={propose} className={bare ? 'mt-3' : 'mt-6'}>
      {subjectId && <input type="hidden" name="subjectId" value={subjectId} />}
      <ComposeBox className="space-y-2 py-2.5">
        <ComposeTitle
          name="goal"
          required
          maxLength={300}
          defaultValue={goal}
          aria-label="What do you want to understand?"
          placeholder="What do you want to understand? Like how a policy rate reaches prices"
        />
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
          <AskButton />
        </div>
      </ComposeBox>
      {state.error && (
        <p role="alert" className="mt-1 text-small text-danger">
          {state.error}
        </p>
      )}
      {state.queued && (
        <p role="status" className="mt-1 text-small text-ink-muted">
          {state.queued}
        </p>
      )}

      <p className="mt-2 text-small text-ink-muted">Dash drafts its levels, and you approve them before anything is asked.</p>
    </form>
  );
}
