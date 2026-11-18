'use client';

import { useActionState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FieldError, Textarea } from '@/components/ui/field';
import { LiveDot } from '@/components/ui/live-dot';
import { askFor, findMore, type AskState } from './actions';

/**
 * The box that takes anything: a topic to learn about, a link, or the text
 * itself. One field, because the person should not have to say which it is.
 */
export function AskBox() {
  const [state, action, pending] = useActionState<AskState, FormData>(askFor, {});
  return (
    <Card padding="dense">
      <form action={action} className="flex flex-col gap-2">
        <Textarea
          id="read-what"
          name="what"
          rows={2}
          aria-label="A topic, a link, or a text to read"
          placeholder="A topic, a link, or paste the text itself"
          aria-describedby={state.error ? 'read-what-error' : undefined}
          className="min-h-11"
          required
        />
        {state.error && <FieldError id="read-what-error">{state.error}</FieldError>}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" pending={pending}>
            Prepare it
          </Button>
          <p className="min-w-0 flex-1 text-small text-ink-muted">
            Dash finds it and prepares it on your Claude subscription. It takes a few minutes.
          </p>
        </div>
      </form>
    </Card>
  );
}

/** Ask for more to read. Nothing is found until this is pressed, so a week away costs nothing. */
export function FindMore({ finding, unread }: { finding: boolean; unread: number }) {
  const [pending, start] = useTransition();
  if (finding) {
    return (
      <span className="flex items-center gap-2 text-small text-ink-muted">
        <LiveDot />
        Dash is finding more to read
      </span>
    );
  }
  return (
    <Button
      type="button"
      variant={unread < 2 ? 'secondary' : 'ghost'}
      pending={pending}
      onClick={() => start(() => findMore())}
    >
      Find me more to read
    </Button>
  );
}
