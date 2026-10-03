'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { CircleAlert, FileText } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { DoneItem, DoneSince, DoneUndo } from '@/lib/goals/done-since';
import { undoRunChangeAction, type UndoChangeState } from './runs/[runId]/actions';
import { DashMark } from '@/components/ui/dash-mark';

/**
 * What Dash did since your last visit (plan #1076): each result with Read,
 * each change to the map with Undo, and any run that failed. The Undo is the
 * run page's (plan #1013), so an undone line reads as undone in both places.
 * The rules are in lib/goals/done-since.ts.
 */

const initial: UndoChangeState = {};

export function DoneSinceList({ done }: { done: DoneSince }) {
  return (
    <Card>
      <ul className="divide-y divide-border">
        {done.items.map((item) => (
          <DoneRow key={`${item.kind}:${item.id}`} item={item} />
        ))}
      </ul>
      {done.more > 0 && (
        <Link
          href="/goals/runs"
          className="card-pad-x row-pad flex items-center gap-1.5 border-t border-border text-small text-ink-muted transition-colors duration-quick hover:text-ink"
        >
          {done.more} more {done.more === 1 ? 'change' : 'changes'} on the Runs page
        </Link>
      )}
    </Card>
  );
}

function DoneRow({ item }: { item: DoneItem }) {
  const undone = item.kind !== 'failed' && item.undo?.state === 'undone';
  // A change Dash made carries its mark (plan #1338); a result is a file, and a failure an alert.
  const Icon = item.kind === 'failed' ? CircleAlert : item.kind === 'result' ? FileText : null;
  const title = item.kind === 'change' ? item.sentence : item.title;
  const meta =
    item.kind === 'failed'
      ? `Failed: ${item.error}`
      : item.kind === 'result'
        ? [item.unread ? 'New result' : 'Result', item.goalTitle].filter(Boolean).join(' · ')
        : item.goalTitle;

  return (
    <li className="card-pad-x row-pad flex flex-wrap items-start gap-x-3 gap-y-1">
      {Icon ? (
        <Icon
          className={`mt-0.5 size-4 shrink-0 ${item.kind === 'failed' ? 'text-danger' : 'text-ink-muted'}`}
          strokeWidth={1.75}
          aria-hidden
        />
      ) : (
        <DashMark size="icon" decorative className="mt-0.5 text-ink-muted" />
      )}
      <span className="min-w-0 flex-1">
        <span
          className={
            undone
              ? 'block text-ui break-words text-ink-muted line-through'
              : 'block text-ui break-words text-ink'
          }
        >
          {title}
        </span>
        {meta && (
          <span
            className={`line-clamp-2 block text-small break-words ${item.kind === 'failed' ? 'text-danger' : 'text-ink-muted'}`}
          >
            {meta}
          </span>
        )}
      </span>
      <span className="flex items-center gap-2">
        {item.kind === 'result' && !undone && (
          <Link href={item.href} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            Read
          </Link>
        )}
        {item.kind === 'failed' && (
          <Link href={item.href} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Open
          </Link>
        )}
        {item.kind !== 'failed' && item.undo && <UndoControl undo={item.undo} />}
      </span>
    </li>
  );
}

function UndoControl({ undo }: { undo: DoneUndo }) {
  const [state, action, pending] = useActionState(undoRunChangeAction, initial);
  if (undo.state === 'undone') return <span className="text-small text-ink-muted">Undone</span>;
  if (undo.state !== 'undoable') {
    return undo.reason ? <span className="text-small text-ink-muted">{undo.reason}</span> : null;
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="runId" value={undo.runId} />
      <input type="hidden" name="key" value={undo.key} />
      <Button type="submit" size="sm" variant="ghost" pending={pending}>
        Undo
      </Button>
      {state.error && <span className="text-small text-danger">{state.error}</span>}
    </form>
  );
}
