'use client';

import { useActionState, useState } from 'react';
import { Bot } from 'lucide-react';
import {
  deleteFeedback,
  editFeedback,
  respondToFeedback,
  updateFeedbackStatus,
  type FeedbackActionState,
} from '@/app/dev/bugs/actions';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { FieldError, Select, Textarea } from '@/components/ui/field';
import { SubmitOnChange } from '@/components/shell/submit-on-change';
import { cn } from '@/lib/cn';
import { isOutstanding, type FeedbackRow, type FeedbackStatus } from '@/lib/feedback/load';
import { surfaceOf } from '@/lib/feedback/surfaces';

// Defined in lib/feedback so both workspaces' pages and this component agree
// on one shape.
export type { FeedbackRow, FeedbackStatus } from '@/lib/feedback/load';

// The tint tokens rather than colour/10: the tints are tuned per theme, and a
// 10% alpha over a dark surface is not the same thing as a tint.
const STATUS_STYLE: Record<FeedbackStatus, string> = {
  open: 'bg-caution-tint text-caution',
  in_progress: 'bg-accent-tint text-accent',
  blocked: 'bg-danger-tint text-danger',
  planned: 'bg-canvas text-ink-muted',
  done: 'bg-positive-tint text-positive',
  declined: 'bg-canvas text-ink-muted',
};

/**
 * What each status is called on the row.
 *
 * Every one is its own word except `in_progress`, which is the interesting
 * one: a note is only ever in progress because a run claimed it, so the honest
 * label is who has it rather than the column's name. It carries the same bot
 * the plan page marks a handed-over step with -- the page said nothing about
 * work going to Claude beyond a status word that reads like any other.
 */
const STATUS_LABEL: Record<FeedbackStatus, string> = {
  open: 'open',
  in_progress: 'Claude is on this',
  blocked: 'blocked',
  planned: 'planned',
  done: 'done',
  declined: 'declined',
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
  const [editState, editAction, editPending] = useActionState(
    editFeedback,
    {} as FeedbackActionState,
  );

  /**
   * Only while the note is still outstanding.
   *
   * A note that has been done or declined is the record of what was asked and
   * what was decided about it; rewording the ask afterwards would leave its
   * resolution note answering a question nobody put. The server refuses it
   * too — this only keeps the button off the cards where it would fail.
   */
  const [editing, setEditing] = useState(false);
  const canEdit = isOutstanding(row);

  /**
   * The form stays open on an error so the text is not lost, and closes when a
   * save actually lands.
   *
   * Compared by identity rather than by the text of the message: the action
   * returns a fresh object per dispatch, so two consecutive saves are
   * distinguishable where two "Saved." strings would not be.
   */
  const [settled, setSettled] = useState<FeedbackActionState | null>(null);
  if (editState.message && editState !== settled) {
    setSettled(editState);
    setEditing(false);
  }

  /**
   * Answering a note that came back with a question.
   *
   * Only where there is a question to answer: blocked and planned are the two
   * states waiting on the person rather than on a run. Behind a button rather
   * than always open, so a queue of twenty notes is not twenty text boxes --
   * the same reason Edit is behind one.
   */
  const [answering, setAnswering] = useState(false);
  const [respondState, respondAction, respondPending] = useActionState(
    respondToFeedback,
    {} as FeedbackActionState,
  );
  const canAnswer = row.status === 'blocked' || row.status === 'planned';

  const [answered, setAnswered] = useState<FeedbackActionState | null>(null);
  if (respondState.message && respondState !== answered) {
    setAnswered(respondState);
    setAnswering(false);
  }

  return (
    <li className="row-pad flex flex-col gap-2 px-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-micro font-semibold uppercase tracking-wide',
            row.kind === 'bug'
              ? 'bg-danger-tint text-danger'
              : 'bg-accent-tint text-accent',
          )}
        >
          {row.kind}
        </span>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-micro font-medium',
            STATUS_STYLE[row.status],
          )}
        >
          {row.status === 'in_progress' && (
            <Bot className="size-3 shrink-0" strokeWidth={2} aria-hidden />
          )}
          {STATUS_LABEL[row.status]}
        </span>
        <span className="text-small text-ink-muted">
          {row.createdAt.slice(0, 10)} · p{row.priority} {PRIORITY_LABEL[row.priority] ?? ''}
          {/* A note filed from /dev/surfaces is a design note, and it read here
            * as the raw string "/preview?s=jobs-pipeline-dense" -- which named
            * neither the surface nor the fact that it is judged against the
            * guide rather than fixed where it sits. */}
          {surfaceOf(row.pagePath) ? (
            <>
              {' · '}
              <a href="/dev/surfaces" className="text-accent hover:underline">
                surface: {surfaceOf(row.pagePath)}
              </a>
              {' · judged against /dev/ui'}
            </>
          ) : (
            (row.pagePath ?? '') && ` · ${row.pagePath}`
          )}
        </span>
        <code className="text-small text-ink-muted">{row.id.slice(0, 8)}</code>
      </div>

      {editing ? (
        <form action={editAction} className="flex flex-col gap-2">
          <input type="hidden" name="id" value={row.id} />
          <Textarea
            name="body"
            rows={4}
            defaultValue={row.body}
            autoFocus
            aria-label="What this note asks for"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Select
              name="kind"
              defaultValue={row.kind}
              className="w-32"
              aria-label="Bug or feature"
            >
              <option value="bug">Bug</option>
              <option value="feature">Feature</option>
            </Select>
            <Button type="submit" size="sm" pending={editPending}>
              {editPending ? 'Saving…' : 'Save'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <p className="whitespace-pre-wrap text-body text-ink">{row.body}</p>
      )}

      {row.resolutionNote && (
        <p className="rounded-lg bg-canvas px-3 py-2 text-ui text-ink-muted">
          {row.status === 'blocked' ? 'Waiting on: ' : ''}
          {row.resolutionNote}
          {row.commitSha ? ` · ${row.commitSha}` : ''}
        </p>
      )}

      {/* Directly under the question, which is where an answer goes. Putting it
          down among Set, Edit and Delete would make replying to a question look
          like another way of triaging the note. */}
      {canAnswer && answering && (
        <form action={respondAction} className="flex flex-col gap-2">
          <input type="hidden" name="id" value={row.id} />
          <Textarea
            name="response"
            rows={3}
            autoFocus
            placeholder="Answer the question above. It goes on the note and the next run reads it."
            aria-label="Your answer"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" pending={respondPending}>
              {respondPending ? 'Sending…' : 'Answer and reopen'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAnswering(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <form action={statusAction} className="flex items-center gap-2">
          <input type="hidden" name="id" value={row.id} />
          <Select
            name="status"
            defaultValue={row.status}
            className="w-32"
            aria-label="Status"
            disabled={statusPending}
          >
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="blocked">Blocked</option>
            <option value="planned">Planned</option>
            <option value="done">Done</option>
            <option value="declined">Declined</option>
          </Select>
          {/* Picking a status is the whole decision; a Set button after it just
              asks you to confirm what you already said. Same treatment the
              inventory filters got: the select submits itself, and the button
              stays in the markup as the way through with JavaScript off. */}
          <SubmitOnChange />
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            pending={statusPending}
            data-fallback-submit
          >
            {statusPending ? 'Saving…' : 'Set'}
          </Button>
          {statusPending && <span className="text-small text-ink-muted">Saving…</span>}
        </form>
        {canAnswer && !answering && (
          <Button type="button" size="sm" variant="secondary" onClick={() => setAnswering(true)}>
            Answer
          </Button>
        )}
        {canEdit && !editing && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
        <form action={deleteAction}>
          <input type="hidden" name="id" value={row.id} />
          <Button type="submit" size="sm" variant="ghost" disabled={deletePending}>
            Delete
          </Button>
        </form>
        <FieldError>
          {statusState.error ?? deleteState.error ?? editState.error ?? respondState.error}
        </FieldError>
      </div>
    </li>
  );
}

export function FeedbackList({ rows }: { rows: FeedbackRow[] }) {
  if (rows.length === 0) return null;
  return (
    <ul className={cn(cardVariants({ padding: 'none' }), 'divide-y divide-border overflow-hidden')}>
      {rows.map((row) => (
        <FeedbackCard key={row.id} row={row} />
      ))}
    </ul>
  );
}
