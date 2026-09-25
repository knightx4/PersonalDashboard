'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import type { ChangeLine } from '@/lib/goals/run-changes';
import { undoRunChangeAction, type UndoChangeState } from './actions';

/**
 * The changes one run made, one sentence each, with Undo on each of Claude's
 * (plan #1013). A change that has moved on since says why it stays.
 */

const initial: UndoChangeState = {};

export function RunChanges({ runId, lines }: { runId: string; lines: ChangeLine[] }) {
  return (
    <ul className="divide-y divide-border">
      {lines.map((line) => (
        <ChangeRow key={line.key} runId={runId} line={line} />
      ))}
    </ul>
  );
}

function ChangeRow({ runId, line }: { runId: string; line: ChangeLine }) {
  const [state, undo, pending] = useActionState(undoRunChangeAction, initial);
  const note =
    line.state === 'undone'
      ? 'Undone'
      : line.state === 'kept' || line.state === 'gone'
        ? line.reason
        : line.actor === 'me'
          ? 'By you'
          : line.actor === 'capture'
            ? 'From capture'
            : null;

  return (
    <li className="row-pad flex flex-wrap items-center gap-x-3 gap-y-1">
      <span
        className={
          line.state === 'undone'
            ? 'min-w-0 flex-1 text-ui break-words text-ink-muted line-through'
            : 'min-w-0 flex-1 text-ui break-words text-ink'
        }
      >
        {line.sentence}
      </span>
      {note && <span className="text-small text-ink-muted">{note}</span>}
      {line.state === 'undoable' && (
        <form action={undo} className="flex items-center gap-2">
          <input type="hidden" name="runId" value={runId} />
          <input type="hidden" name="key" value={line.key} />
          <Button type="submit" size="sm" variant="ghost" pending={pending}>
            Undo
          </Button>
        </form>
      )}
      {state.error && <span className="w-full text-small text-danger">{state.error}</span>}
      {state.message && <span className="w-full text-small text-ink-muted">{state.message}</span>}
    </li>
  );
}
