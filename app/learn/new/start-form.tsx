'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';
import { startTrack, type NewTrackState } from './actions';

/**
 * Starting a topic with nothing in it.
 *
 * The other way in on this page pastes a list somebody else wrote. This one is
 * for when you already know what you want to learn and nobody has told you
 * what to read yet -- which is the more common starting point, and until now
 * had no door at all.
 *
 * It writes immediately. The import path has a confirm step because a resolver
 * proposed things that might be wrong; here you typed a name, so there is
 * nothing to check.
 */

function StartButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      {pending ? 'Starting…' : 'Start the topic'}
    </Button>
  );
}

export function StartForm() {
  const [state, formAction] = useActionState<NewTrackState, FormData>(startTrack, {});

  return (
    <form action={formAction}>
      <Field
        label="What do you want to learn about?"
        id="start-title"
        hint="The broad thing. You add the specific parts on the next screen."
      >
        <Input id="start-title" name="title" required maxLength={300} placeholder="Central banking" />
      </Field>

      <Field
        label="Anything particular you are trying to work out?"
        id="start-question"
        hint="Optional. It is what each source gets aimed at later, so a specific one is worth writing."
      >
        <Textarea
          id="start-question"
          name="question"
          rows={2}
          placeholder="How does raising a policy rate actually reach the price of anything?"
        />
      </Field>

      <div className="mt-4 flex items-center gap-3">
        <StartButton />
        {state.error && <span className="text-ui text-danger">{state.error}</span>}
      </div>
    </form>
  );
}
