'use client';

import { useActionState, useState, useTransition } from 'react';
import Link from 'next/link';
import { ListPlus, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FieldError, Input } from '@/components/ui/field';
import { PaidHint } from '@/components/ui/paid-hint';
import { SNOOZE_DAYS, type WaitingOnYou } from '@/lib/jobs/today/load';
import { addLinkedTask, type LinkedTaskState } from '@/app/todo/link-actions';
import { completeWaiting, snoozeWaiting } from './actions';
import { prepareWithDash, type PrepareState } from './prepare-actions';

/**
 * Same two answers as a reminder -- dealt with, or not now -- for the one
 * section that is not backed by a reminder row: a request already answered.
 */
function DismissActions({
  onComplete,
  onSnooze,
}: {
  onComplete: () => Promise<{ error: string | null }>;
  onSnooze: () => Promise<{ error: string | null }>;
}) {
  const [busy, startTransition] = useTransition();

  return (
    <span className="ml-auto flex shrink-0 items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        pending={busy}
        onClick={() => startTransition(() => void onSnooze())}
        title={`Brings it back in ${SNOOZE_DAYS} days`}
      >
        Later
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        pending={busy}
        onClick={() => startTransition(() => void onComplete())}
        title="Takes it off this list for good"
      >
        Dismiss
      </Button>
    </span>
  );
}

/**
 * What can be done about a request waiting on you, under it: put it on the
 * to-do list, ask Dash to help prepare, or set it aside.
 *
 * The to-do is linked to the role, so it shows on the role's page and on the
 * Todo agenda; its title starts as the request, to be cut down or kept.
 * Preparing asks on the role's comment thread (prepare-actions.ts), and the
 * row links there once Dash has answered.
 */
export function WaitingActions({ row }: { row: WaitingOnYou }) {
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [todo, addTodo, addingTodo] = useActionState<LinkedTaskState, FormData>(async (prev, data) => {
    const result = await addLinkedTask(prev, data);
    if (result.message) {
      setAdding(false);
      setAdded(true);
    }
    return result;
  }, {});
  const [prep, prepare, preparing] = useActionState<PrepareState, FormData>(
    () => prepareWithDash(row.eventId),
    { error: null },
  );

  return (
    <div className="w-full space-y-2">
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
        {added ? (
          <span className="px-2 text-small text-ink-muted">Added to your to-dos</span>
        ) : (
          <Button type="button" variant="ghost" size="sm" onClick={() => setAdding((open) => !open)}>
            <ListPlus className="size-3.5" strokeWidth={2} aria-hidden />
            {adding ? 'Cancel' : 'Add a to-do'}
          </Button>
        )}
        {prep.href && !preparing ? (
          <Link
            href={prep.href}
            className="press-area px-2 text-small text-accent underline underline-offset-2"
          >
            {prep.error ? 'See what went wrong' : 'Read Dash’s help'}
          </Link>
        ) : (
          <span className="flex items-center gap-1">
            <form action={prepare}>
              <Button type="submit" variant="ghost" size="sm" pending={preparing}>
                <Sparkles className="size-3.5" strokeWidth={2} aria-hidden />
                {preparing ? 'Dash is reading it…' : 'Prepare with Dash'}
              </Button>
            </form>
            <PaidHint action="app/jobs/(app)/_home/prepare-actions.ts#prepareWithDash" what="Cost of Dash’s help" />
          </span>
        )}
        <DismissActions
          onComplete={() => completeWaiting(row.eventId)}
          onSnooze={() => snoozeWaiting(row.eventId)}
        />
      </div>

      {adding && (
        <form action={addTodo} className="space-y-2">
          <input type="hidden" name="target" value="role" />
          <input type="hidden" name="targetId" value={row.roleId} />
          <input type="hidden" name="returnTo" value="/jobs" />
          <Input
            name="title"
            defaultValue={todoTitle(row)}
            aria-label="To-do"
            required
            autoFocus
          />
          <div className="flex items-center gap-2">
            <Input name="dueOn" type="date" aria-label="Due" className="w-40" />
            <Button type="submit" size="sm" pending={addingTodo}>
              Add
            </Button>
          </div>
          <FieldError>{todo.error}</FieldError>
        </form>
      )}
      {prep.error && !preparing && <FieldError>{prep.error}</FieldError>}
    </div>
  );
}

/** The request as a to-do: the company, then what they asked, at most a line or two. */
function todoTitle(row: WaitingOnYou): string {
  const ask = (row.summary ?? 'Reply to them').trim();
  const title = `${row.companyName}: ${ask}`;
  return title.length > 160 ? `${title.slice(0, 157).trimEnd()}…` : title;
}
