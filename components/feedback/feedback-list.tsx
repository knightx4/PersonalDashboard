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
import { CommentThread } from '@/components/dev/comment-thread';
import { StateLabel, type DevTone } from '@/components/dev/state-label';
import { cardVariants } from '@/components/ui/card';
import { FieldError, Select, Textarea } from '@/components/ui/field';
import { SubmitOnChange } from '@/components/shell/submit-on-change';
import { cn } from '@/lib/cn';
import { DEV_STATE_WORD } from '@/lib/dev/words';
import { FEEDBACK_STATUS_GLYPHS } from '@/lib/status-glyphs';
import { isOutstanding, type FeedbackRow, type FeedbackStatus } from '@/lib/feedback/load';
import { surfaceOf } from '@/lib/feedback/surfaces';

// Defined in lib/feedback so both workspaces' pages and this component agree
// on one shape.
export type { FeedbackRow, FeedbackStatus } from '@/lib/feedback/load';

// A tone rather than a tinted lozenge. The plan has drawn its states as a
// hexagon and a word for a while; this queue drew a capsule, so the same fact
// looked like two different kinds of thing on two tabs.
const STATUS_TONE: Record<FeedbackStatus, DevTone> = {
  open: 'info',
  in_progress: 'accent',
  blocked: 'caution',
  planned: 'quiet',
  done: 'positive',
  declined: 'ghost',
};

/**
 * What each status is called on the row.
 *
 * Four of the six are states every dev queue has, so the word comes from
 * lib/dev/words.ts and a note reads the way the same thing reads on the plan.
 * `planned` is this queue's own -- the note has been written into the build
 * plan and is worked from there.
 *
 * `in_progress` used to say "Dash is on this", which is who rather than what.
 * Who still shows: the bot beside the word, the same one the plan marks a
 * handed-over step with.
 */
const STATUS_LABEL: Record<FeedbackStatus, string> = {
  open: DEV_STATE_WORD.ready,
  in_progress: DEV_STATE_WORD.working,
  blocked: DEV_STATE_WORD.waiting,
  planned: 'Planned',
  done: DEV_STATE_WORD.done,
  declined: DEV_STATE_WORD.dropped,
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
   * states waiting on the person rather than on a run. It is written in the
   * thread rather than in a box of its own -- #393 -- so the card has one
   * place to type and the answer sits where the next run reads it.
   */
  const canAnswer = row.status === 'blocked' || row.status === 'planned';

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
        <StateLabel
          glyph={FEEDBACK_STATUS_GLYPHS[row.status]}
          word={STATUS_LABEL[row.status]}
          tone={STATUS_TONE[row.status]}
        >
          {row.status === 'in_progress' && (
            <Bot className="size-3 shrink-0" strokeWidth={2} aria-hidden />
          )}
        </StateLabel>
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

      {/* Under the note and its resolution note, above the row of buttons: what
          was written after filing belongs with the report, not among the
          controls for triaging it. A closed note keeps its thread, which is the
          record of what was said while it was being fixed. */}
      <CommentThread
        target="note"
        id={row.id}
        thread={row.thread}
        submit={canAnswer ? { action: respondToFeedback, label: 'Answer and reopen' } : undefined}
        placeholder={
          canAnswer
            ? 'Answer the question above. It goes in the thread, and the note goes back in the queue.'
            : 'Anything you have to add to this note since filing it. The run that picks it up reads it; tag @dash to ask about it.'
        }
      />

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
        <FieldError>{statusState.error ?? deleteState.error ?? editState.error}</FieldError>
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
