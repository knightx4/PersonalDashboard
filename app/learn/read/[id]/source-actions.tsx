'use client';

import { useActionState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { FieldError, Textarea } from '@/components/ui/field';
import type { ReaderStatus } from '@/lib/learn/reader/shelves';
import { addYourCopy, judgeSource, startPreparing, type AskState } from '../actions';

/** While a source is being prepared the page reloads itself, and a stopped or waiting one can be started. */
export function Preparing({ sourceId, status }: { sourceId: string; status: ReaderStatus }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  useEffect(() => {
    if (status === 'failed') return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 8000);
    return () => clearInterval(timer);
  }, [router, status]);
  if (status === 'preparing') return null;
  return (
    <Button
      type="button"
      variant="secondary"
      pending={pending}
      onClick={() => start(() => startPreparing(sourceId))}
    >
      {status === 'failed' ? 'Try again' : 'Start it now'}
    </Button>
  );
}

/** Paste your own copy of a work whose text cannot be shown. */
export function YourCopy({
  sourceId,
  waiting,
  given,
}: {
  sourceId: string;
  waiting: boolean;
  given: boolean;
}) {
  const [state, action, pending] = useActionState<AskState, FormData>(
    addYourCopy.bind(null, sourceId),
    {},
  );
  if (waiting)
    return (
      <p className="text-ui text-ink">
        Dash is preparing this again from your copy. What is here stays readable meanwhile.
      </p>
    );
  return (
    <form action={action} className="flex flex-col gap-2">
      <Textarea
        id="read-copy"
        name="copy"
        rows={4}
        aria-label="Your copy of the text"
        placeholder={
          given ? 'Paste again to replace the copy you gave' : 'Paste the chapter or paper here'
        }
        aria-describedby={state.error ? 'read-copy-error' : undefined}
        required
      />
      {state.error && <FieldError id="read-copy-error">{state.error}</FieldError>}
      <div>
        <Button type="submit" variant="secondary" pending={pending}>
          Prepare it from my copy
        </Button>
      </div>
    </form>
  );
}

/** Keep it, or say it is not for you. */
export function Verdict({
  sourceId,
  verdict,
}: {
  sourceId: string;
  verdict: 'kept' | 'dropped' | null;
}) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="secondary"
        pressed={verdict === 'kept'}
        aria-pressed={verdict === 'kept'}
        disabled={pending}
        onClick={() => start(() => judgeSource(sourceId, 'kept'))}
      >
        Keep
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={pending}
        onClick={() => start(() => judgeSource(sourceId, 'dropped'))}
      >
        Not for me
      </Button>
    </div>
  );
}
