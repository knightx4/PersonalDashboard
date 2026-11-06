'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { setStepStatusAction } from './actions';

type State = { error?: string; done?: boolean };

/**
 * Done on the Now card of a goal's Dashboard (plan #2778.4), for a step of
 * yours that can be ticked straight from there, as the approved mockup
 * draws it. A question or a proposal has no Done: its title opens it.
 */
export function StripDone({ stepId }: { stepId: string }) {
  const [state, close, closing] = useActionState(
    async (_prev: State, form: FormData): Promise<State> => {
      const result = await setStepStatusAction(form);
      return result.error ? { error: result.error } : { done: true };
    },
    {} as State,
  );
  if (state.done) return <span className="text-small text-ink-muted">Done</span>;
  return (
    <form action={close} className="flex shrink-0 items-center gap-2">
      <input type="hidden" name="id" value={stepId} />
      <input type="hidden" name="status" value="done" />
      {state.error && (
        <span role="alert" className="text-small text-danger">
          {state.error}
        </span>
      )}
      <Button type="submit" size="sm" pending={closing}>
        Done
      </Button>
    </form>
  );
}
