'use client';

import { useActionState } from 'react';
import {
  deleteFeedback,
  updateFeedbackStatus,
  type FeedbackActionState,
} from './actions';
import { Button } from '@/components/ui/button';
import { FieldError, Select } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import type { FeedbackRow, FeedbackStatus } from '@/lib/feedback/load';

// Defined in lib/feedback so both workspaces' pages and this component agree
// on one shape.
export type { FeedbackRow, FeedbackStatus } from '@/lib/feedback/load';

const STATUS_STYLE: Record<FeedbackStatus, string> = {
  open: 'bg-caution-fill/10 text-caution',
  in_progress: 'bg-accent-tint text-accent',
  blocked: 'bg-danger/10 text-danger',
  planned: 'bg-canvas text-ink-muted',
  done: 'bg-positive/10 text-positive',
  declined: 'bg-canvas text-ink-muted',
};

const PRIORITY_LABEL: Record<number, string> = {
  1: 'next',
  2: 'normal',
  3: 'someday',
};

function FeedbackCard({ row }: { row: FeedbackRow }) {
  const [statusState, statusAction, statusPending] = useActionState(
    updateFeedbackStatus,
    {} as FeedbackActionState,
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteFeedback,
    {} as FeedbackActionState,
  );

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-micro font-semibold uppercase tracking-wide',
            row.kind === 'bug'
              ? 'bg-danger/10 text-danger'
              : 'bg-accent-tint text-accent',
          )}
        >
          {row.kind}
        </span>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-micro font-medium',
            STATUS_STYLE[row.status],
          )}
        >
          {row.status}
        </span>
        <span className="text-small text-ink-muted">
          {row.createdAt.slice(0, 10)} · p{row.priority} {PRIORITY_LABEL[row.priority] ?? ''}
          {row.pagePath ? ` · ${row.pagePath}` : ''}
        </span>
        <code className="text-micro text-ink-muted">{row.id.slice(0, 8)}</code>
      </div>

      <p className="whitespace-pre-wrap text-body text-ink">{row.body}</p>

      {row.resolutionNote && (
        <p className="rounded-lg bg-canvas px-3 py-2 text-ui text-ink-muted">
          {row.status === 'blocked' ? 'Waiting on: ' : ''}
          {row.resolutionNote}
          {row.commitSha ? ` · ${row.commitSha}` : ''}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <form action={statusAction} className="flex items-center gap-2">
          <input type="hidden" name="id" value={row.id} />
          <Select
            name="status"
            defaultValue={row.status}
            className="w-32"
            aria-label="Status"
          >
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="blocked">Blocked</option>
            <option value="planned">Planned</option>
            <option value="done">Done</option>
            <option value="declined">Declined</option>
          </Select>
          <Button type="submit" size="sm" variant="secondary" disabled={statusPending}>
            {statusPending ? 'Saving…' : 'Set'}
          </Button>
        </form>
        <form action={deleteAction}>
          <input type="hidden" name="id" value={row.id} />
          <Button type="submit" size="sm" variant="ghost" disabled={deletePending}>
            Delete
          </Button>
        </form>
        <FieldError>{statusState.error ?? deleteState.error}</FieldError>
      </div>
    </li>
  );
}

export function FeedbackList({ rows }: { rows: FeedbackRow[] }) {
  if (rows.length === 0) return null;
  return (
    <ul className="divide-y divide-border rounded-card border border-border bg-surface">
      {rows.map((row) => (
        <FeedbackCard key={row.id} row={row} />
      ))}
    </ul>
  );
}
