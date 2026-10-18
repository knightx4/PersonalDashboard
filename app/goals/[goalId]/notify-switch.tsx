'use client';

import { useId, useState, useTransition } from 'react';
import { Switch } from '@/components/ui/field';
import type { StepNode } from '@/lib/goals/steps';
import { setStepNotifyAction } from './actions';

/**
 * On a step Dash is doing, whether your phone gets a message when Dash
 * closes it as done (plan #2376.2). Off until you turn it on, saved on the
 * press; a save that fails puts the switch back and says so beneath it.
 *
 * The caller draws it only on an open `claude` step's own page. `error` is
 * for the gallery, which draws the failed save; nothing in the app passes it.
 */
export function NotifySwitch({ node, error: shownError }: { node: StepNode; error?: string }) {
  const id = useId();
  const [on, setOn] = useState(node.notifyOnDone ?? false);
  const [error, setError] = useState<string | null>(shownError ?? null);
  const [pending, start] = useTransition();

  return (
    <div>
      <div className="flex items-center gap-2.5 max-sm:min-h-11">
        <Switch
          id={id}
          checked={on}
          disabled={pending}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => {
            const next = event.target.checked;
            setOn(next);
            setError(null);
            start(async () => {
              const form = new FormData();
              form.set('id', node.id);
              form.set('on', String(next));
              const result = await setStepNotifyAction(form).catch(() => ({
                error: 'The notification setting could not be saved. Try again.',
              }));
              if (result.error) {
                setOn(!next);
                setError(result.error);
              }
            });
          }}
        />
        <label htmlFor={id} className="cursor-pointer text-ui text-ink">
          Notify my phone when Dash finishes this
        </label>
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-0.5 text-small text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
