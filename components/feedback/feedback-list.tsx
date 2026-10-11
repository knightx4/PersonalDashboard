'use client';

import { useActionState, useState } from 'react';
import { DashMark } from '@/components/ui/dash-mark';
import {
  deleteFeedback,
  editFeedback,
  respondToFeedback,
  updateFeedbackStatus,
  type FeedbackActionState,
} from '@/app/dev/bugs/actions';
import { Button } from '@/components/ui/button';
import { Thread } from '@/components/thread/thread';
import { threadRef } from '@/lib/thread/subjects';
import { StateLabel, type DevTone } from '@/components/dev/state-label';
import { cardVariants } from '@/components/ui/card';
import { FieldError, Select, Textarea } from '@/components/ui/field';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';
import { TONE_TEXT } from '@/components/dev/state-label';
import { cn } from '@/lib/cn';
import { feedbackHealth, type FeedbackHealth } from '@/lib/dev/health';
import { FEEDBACK_HEALTH_WORD } from '@/lib/dev/words';
import { FEEDBACK_HEALTH_GLYPHS } from '@/lib/status-glyphs';
import {
  FEEDBACK_KINDS,
  FEEDBACK_KIND_LABEL,
  isOutstanding,
  type FeedbackRow,
} from '@/lib/feedback/load';
import { surfaceOf } from '@/lib/feedback/surfaces';
import { KIND_TONE } from '@/components/feedback/kind-tone';
import { TriageNote } from '@/components/feedback/triage-note';
import { triageView } from '@/lib/feedback/triage';
import { LinkedText } from '@/components/ui/linked-text';
import { AttachmentList } from '@/components/attachments/attachment-list';

// Defined in lib/feedback so both workspaces' pages and this component agree
// on one shape.
export type { FeedbackRow, FeedbackStatus } from '@/lib/feedback/load';

// A tone rather than a tinted lozenge. The plan has drawn its states as a
// hexagon and a word for a while; this queue drew a capsule, so the same fact
// looked like two different kinds of thing on two tabs.
const HEALTH_TONE: Record<FeedbackHealth, DevTone> = {
  waiting: 'caution',
  answered: 'positive',
  ready: 'info',
  planned: 'quiet',
  working: 'accent',
  done: 'positive',
  dropped: 'ghost',
};

const PRIORITY_LABEL: Record<number, string> = {
  1: 'next',
  2: 'normal',
  3: 'someday',
};

const STATUS_OPTIONS: [string, string][] = [
  ['open', 'Open'],
  ['in_progress', 'In progress'],
  ['blocked', 'Blocked'],
  ['planned', 'Planned'],
  ['done', 'Done'],
  ['declined', 'Declined'],
];

function FeedbackCard({ row }: { row: FeedbackRow }) {
  // The status picker and the overflow menu run their actions from a menu,
  // which passes the form data alone and drops what comes back. A refusal is
  // kept here so it still shows under the note.
  const [menuError, setMenuError] = useState<string | undefined>();
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

  // What the note means, not what its column says. `blocked` is two states and
  // only the thread tells them apart.
  const health = feedbackHealth(row);

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

  async function run(
    action: (prev: FeedbackActionState, formData: FormData) => Promise<FeedbackActionState>,
    formData: FormData,
  ) {
    const result = await action({}, formData);
    setMenuError(result.error);
  }

  const statusItems: ActionMenuItem[] = STATUS_OPTIONS.map(([value, label]) => ({
    id: value,
    label,
    disabled: value === row.status,
    formAction: (formData) => run(updateFeedbackStatus, formData),
    formFields: { id: row.id, status: value },
  }));

  const noteItems: ActionMenuItem[] = [
    ...(canEdit && !editing
      ? [{ id: 'edit', label: 'Edit', onSelect: () => setEditing(true) }]
      : []),
    {
      id: 'delete',
      label: 'Delete',
      destructive: true,
      confirm: 'Delete this note?',
      formAction: (formData) => run(deleteFeedback, formData),
      formFields: { id: row.id },
    },
  ];

  return (
    // The id is where the app-wide search lands a note: /dev/bugs#note-<id>.
    <li id={`note-${row.id}`} className="row-pad flex scroll-mt-bar flex-col gap-2 px-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-micro font-semibold uppercase tracking-wide',
            KIND_TONE[row.kind],
          )}
        >
          {FEEDBACK_KIND_LABEL[row.kind]}
        </span>
        {/* The status is a word you press, which opens the picker: the select
            and its Set button used to sit in a row of their own under every
            note. */}
        <ActionMenu
          label="Change status"
          items={statusItems}
          align="start"
          triggerClassName={cn(
            'h-7 w-auto gap-1.5 px-1.5 text-small font-medium',
            TONE_TEXT[HEALTH_TONE[health]],
          )}
          trigger={
            <StateLabel
              className="text-inherit"
              glyph={FEEDBACK_HEALTH_GLYPHS[health]}
              word={FEEDBACK_HEALTH_WORD[health]}
              tone={HEALTH_TONE[health]}
              title={
                health === 'answered'
                  ? "You replied, so it is a session's again. The status column still says blocked."
                  : undefined
              }
            >
              {/* Who has it, which the word deliberately does not say. Dash's
                  mark, at rest: the word beside it already says it is being
                  worked. */}
              {health === 'working' && <DashMark size="2xs" decorative />}
            </StateLabel>
          }
        />
        <span className="text-small text-ink-muted">
          {row.createdAt.slice(0, 10)}
          {/* The rest of the line is for a wider screen: on a phone the top
              line is the type, the status, the date and the menu. */}
          <span className="max-sm:hidden">
            {' · '}p{row.priority} {PRIORITY_LABEL[row.priority] ?? ''}
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
        </span>
        <code className="text-small text-ink-muted max-sm:hidden">{row.id.slice(0, 8)}</code>
        <ActionMenu label="Note actions" items={noteItems} className="ml-auto" />
      </div>
      <TriageNote view={triageView(row.triage ?? null)} />

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
              aria-label="Bug, feature or like"
            >
              {FEEDBACK_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {FEEDBACK_KIND_LABEL[kind]}
                </option>
              ))}
            </Select>
            <Button type="submit" size="sm" pending={editPending}>
              {editPending ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <p className="whitespace-pre-wrap text-body text-ink">
          <LinkedText text={row.body} />
        </p>
      )}

      {/* What was filed with it, such as the screenshot of what went wrong
          (plan #1713). Under the text while editing too: the files are not
          part of what the form changes. */}
      <AttachmentList files={row.attachments ?? []} />

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
      <Thread
        subject={threadRef('note', row.id)}
        turns={row.thread}
        submit={canAnswer ? { action: respondToFeedback, label: 'Answer and reopen' } : undefined}
        placeholder={
          canAnswer
            ? 'Answer the question above. It goes in the thread, and the note goes back in the queue.'
            : 'Anything you have to add to this note since filing it. The run that picks it up reads it; tag @dash to ask about it.'
        }
      />

      <FieldError>{menuError ?? editState.error}</FieldError>
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
