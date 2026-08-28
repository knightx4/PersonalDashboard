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

export type FeedbackStatus =
  | 'open'
  | 'in_progress'
  | 'blocked'
  | 'planned'
  | 'done'
  | 'declined';

export type FeedbackRow = {
  id: string;
  kind: 'bug' | 'feature';
  body: string;
  pagePath: string | null;
  status: FeedbackStatus;
  priority: number;
  resolutionNote: string | null;
  commitSha: string | null;
  createdAt: string;
};

const STATUS_STYLE: Record<FeedbackStatus, string> = {
  open: 'bg-accent-orange/10 text-accent-orange',
  in_progress: 'bg-brand-tint text-brand',
  blocked: 'bg-red-500/10 text-red-600',
  planned: 'bg-canvas text-ink-muted',
  done: 'bg-emerald-500/10 text-emerald-600',
  declined: 'bg-canvas text-ink-faint',
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
            'rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
            row.kind === 'bug'
              ? 'bg-red-500/10 text-red-600'
              : 'bg-brand-tint text-brand',
          )}
        >
          {row.kind}
        </span>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[11px] font-medium',
            STATUS_STYLE[row.status],
          )}
        >
          {row.status}
        </span>
        <span className="text-[12px] text-ink-faint">
          {row.createdAt.slice(0, 10)} · p{row.priority} {PRIORITY_LABEL[row.priority] ?? ''}
          {row.pagePath ? ` · ${row.pagePath}` : ''}
        </span>
        <code className="text-[11px] text-ink-faint">{row.id.slice(0, 8)}</code>
      </div>

      <p className="whitespace-pre-wrap text-sm text-ink">{row.body}</p>

      {row.resolutionNote && (
        <p className="rounded-lg bg-canvas px-3 py-2 text-[13px] text-ink-muted">
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
