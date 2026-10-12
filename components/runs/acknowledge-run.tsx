'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';

export type AcknowledgeRunState = { error?: string };

const initial: AcknowledgeRunState = {};

/**
 * The press that ends a run that has gone quiet (plan #1826). A stale run
 * stays on its page, saying so, until you have seen it; pressing this closes
 * it as failed with ACKNOWLEDGED_STALE_ERROR as its reason. The action is
 * the runs table's own: the plan's or the goals'.
 */
export function AcknowledgeRun({
  runId,
  action,
}: {
  runId: string;
  action: (prev: AcknowledgeRunState, form: FormData) => Promise<AcknowledgeRunState>;
}) {
  const [state, acknowledge, pending] = useActionState(action, initial);

  return (
    <form action={acknowledge} className="flex flex-col items-end gap-1">
      <input type="hidden" name="runId" value={runId} />
      <Button type="submit" size="sm" variant="secondary" pending={pending}>
        Acknowledge
      </Button>
      {state.error && <FieldError>{state.error}</FieldError>}
    </form>
  );
}
