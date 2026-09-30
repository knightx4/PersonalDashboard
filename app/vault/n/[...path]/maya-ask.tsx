'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { PaidHint } from '@/components/ui/paid-hint';
import { askMaya, type AskMayaState } from './actions';

/**
 * The press that asks Maya about this note (plan #1285).
 *
 * The call is Opus with web search and takes tens of seconds, so while it
 * runs the button says Maya is thinking and a line under it says how long to
 * expect. On success the action revalidates the page, which then draws the
 * thread and the thought from the database; this component only ever shows
 * the refusal or failure, if there is one.
 */

export const MAYA_WAIT =
  'This can take a minute: Maya reads your related notes and looks for outside sources.';

function AskButton({ again }: { again: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" pending={pending}>
      {pending ? 'Maya is thinking…' : again ? 'Ask Maya again' : 'Ask Maya'}
    </Button>
  );
}

function Waiting() {
  const { pending } = useFormStatus();
  if (!pending) return null;
  return <p className="mt-2 text-small text-ink-muted">{MAYA_WAIT}</p>;
}

export function MayaAsk({ notePath, again }: { notePath: string; again: boolean }) {
  const [state, ask] = useActionState<AskMayaState, FormData>(askMaya, {});
  return (
    <form action={ask} className="mt-3">
      <input type="hidden" name="notePath" value={notePath} />
      {state.error && <p className="mb-2 text-ui text-caution">{state.error}</p>}
      <div className="flex items-center gap-3">
        <AskButton again={again} />
        <PaidHint action="app/vault/n/[...path]/actions.ts#askMaya" what="Cost of asking Maya" />
      </div>
      <Waiting />
    </form>
  );
}
