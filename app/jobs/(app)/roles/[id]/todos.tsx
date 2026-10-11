'use client';

import { useState, useTransition } from 'react';
import { Mail, MoreHorizontal, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { LinkedTasks } from '@/components/todo/linked-tasks';
import { ReminderActions } from '@/app/jobs/(app)/_home/reminder-actions';
import { completeReminder } from '@/app/jobs/(app)/_home/actions';
import { StatusGlyph } from '@/components/ui/status-glyph';
import { TASK_STATUS_GLYPHS } from '@/lib/status-glyphs';
import { formatDate } from '@/lib/jobs/applications/load';
import type { Task } from '@/lib/todo/tasks/model';
import { linkReminderMessage, updateReminder } from './timeline-actions';
import { GmailLink } from './shared';
import type { PanelProps, RoleReminder } from './types';

type RoleMail = Pick<PanelProps['messages'][number], 'id' | 'subject' | 'receivedAt'>[];

/**
 * The role's one to-do list (plan #1594).
 *
 * There were two: the Todo module's tasks above the tabs, and the job
 * module's reminders in a card of their own on the timeline, each with its
 * own Add. They answer one question, so they are one list. A new to-do goes
 * to Todo, where it shows on the agenda with everything else; the reminders
 * the nightly sweep and the inbox raise stay in the same list, finished,
 * pushed back or corrected where they are.
 */
export function RoleTodos({
  roleId,
  tasks,
  reminders,
  messages,
  timezone,
}: {
  roleId: string;
  tasks: Task[];
  reminders: RoleReminder[];
  messages: RoleMail;
  timezone: string;
}) {
  return (
    <LinkedTasks
      target="role"
      targetId={roleId}
      returnTo={`/jobs/roles/${roleId}`}
      tasks={tasks}
      timezone={timezone}
      title="To-dos"
      addLabel="Add a to-do"
      extraCount={reminders.length}
      extra={
        reminders.length > 0 ? (
          <ul
            className={
              tasks.length > 0
                ? 'divide-y divide-border border-t border-border'
                : 'mt-2 divide-y divide-border'
            }
          >
            {reminders.map((reminder) => (
              <li key={reminder.id} className="py-1.5 text-ui">
                <TodoLine todo={reminder} messages={messages} timezone={timezone} />
              </li>
            ))}
          </ul>
        ) : null
      }
    />
  );
}

/** The day a to-do is due, as the task rows write theirs: "16 Sept". */
function shortDay(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  }).format(date);
}

/**
 * The date a `type="date"` input wants, from the timestamp we stored.
 *
 * Read back in UTC because that is how it was written -- `addReminder` turns
 * the picked day into midnight UTC -- so a to-do that is not edited comes back
 * out of the picker as the day that went in.
 */
function dueDateInput(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * One to-do, and the way to correct it.
 *
 * The wording of a to-do is a first guess typed while reading the mail that
 * prompted it, and the date is usually a guess as well. Without this the only
 * way to fix either was to finish it and write a new one, which throws away
 * the mail it was linked to -- so "rename it" quietly cost more than it looks
 * like it should.
 */
function TodoLine({
  todo,
  messages,
  timezone,
}: {
  todo: RoleReminder;
  messages: RoleMail;
  timezone: string;
}) {
  const [editing, setEditing] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [finishing, finish] = useTransition();
  const [body, setBody] = useState(todo.body);
  const [dueAt, setDueAt] = useState(() => dueDateInput(todo.dueAt));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function open() {
    // From the row as it stands, not from whatever was typed and abandoned
    // the last time this was opened.
    setBody(todo.body);
    setDueAt(dueDateInput(todo.dueAt));
    setError(null);
    setEditing(true);
  }

  if (!editing) {
    return (
      /* Drawn as the task rows above it are (plan #1594): the hexagon, the
       * words, the date, and one control at the end where a task has its
       * detach. That control opens the row's answers -- Edit, Later, Done --
       * rather than leaving three buttons standing on every to-do, which at
       * 390px took a line of their own. The email it came from is a quiet
       * line under the words. */
      <div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Mark done"
            disabled={finishing}
            onClick={() => finish(() => void completeReminder(todo.id))}
            className="press flex size-4 shrink-0 items-center justify-center text-ink-muted transition-colors duration-quick hover:text-accent"
          >
            <StatusGlyph glyph={TASK_STATUS_GLYPHS.open} size={14} />
          </button>
          <span className="min-w-0 flex-1 truncate text-ui text-ink">{todo.body}</span>
          <span className="tabular shrink-0 text-small text-ink-muted">{shortDay(todo.dueAt)}</span>
          <button
            type="button"
            aria-expanded={answering}
            title={answering ? 'Close' : 'Edit, push back or finish it'}
            onClick={() => setAnswering((value) => !value)}
            className="press flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors duration-quick hover:bg-sunken hover:text-ink"
          >
            <MoreHorizontal className="size-3.5" strokeWidth={1.75} aria-hidden />
            <span className="sr-only">{answering ? 'Close' : 'Edit, push back or finish it'}</span>
          </button>
        </div>
        <TodoMail todo={todo} messages={messages} timezone={timezone} offer={false} />
        {answering && (
          // Inset so Edit's words start under the to-do's, its own padding
          // taken off the hexagon's width and gap.
          <div className="flex items-center gap-1 pb-1 pl-3.5">
            <Button type="button" size="sm" variant="ghost" onClick={open}>
              Edit
            </Button>
            <span className="flex">
              <ReminderActions id={todo.id} />
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-48 flex-1">
        <Input value={body} onChange={(event) => setBody(event.target.value)} aria-label="To-do" />
      </div>
      <Input
        type="date"
        value={dueAt}
        onChange={(event) => setDueAt(event.target.value)}
        aria-label="Done by"
        className="w-40"
      />
      <Button
        type="button"
        size="sm"
        disabled={pending || !body.trim() || !dueAt}
        onClick={() =>
          startTransition(async () => {
            const result = await updateReminder({ reminderId: todo.id, body, dueAt });
            setError(result.error);
            if (!result.error) setEditing(false);
          })
        }
      >
        Save
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
        Cancel
      </Button>
      {error && <span className="text-small text-danger">{error}</span>}
      <TodoMail todo={todo} messages={messages} timezone={timezone} offer />
    </div>
  );
}

/**
 * The email a to-do is about.
 *
 * "Submit the take-home" and the mail that sent the take-home were the same
 * thing in two tabs, joined only by remembering the subject line. Named here,
 * the to-do carries the link to the mailbox with it.
 *
 * The picker is the mail already linked to this pursuit, which is the whole of
 * what a to-do on this role could sensibly point at -- and it stays closed
 * until asked for, so a list of to-dos does not become a list of dropdowns.
 */
function TodoMail({
  todo,
  messages,
  timezone,
  offer,
}: {
  todo: RoleReminder;
  messages: RoleMail;
  timezone: string;
  /**
   * Whether to offer linking one when there is none. Off in the row: an
   * unlinked to-do was printing "Link an email" underneath itself forever,
   * which is a whole third line spent saying that nothing is there. It is
   * offered where the rest of the to-do is corrected instead -- under Edit,
   * beside the wording and the date, which is where you already are when you
   * want to attach the mail it came from.
   */
  offer: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(messageId: string | null) {
    startTransition(async () => {
      const result = await linkReminderMessage({ reminderId: todo.id, messageId });
      setError(result.error);
      if (!result.error) setPicking(false);
    });
  }

  if (todo.message) {
    return (
      <p className="flex min-w-0 items-center gap-1.5 pl-6 text-small text-ink-muted">
        <Mail className="size-3.5 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
        {/* Not truncated: clipping would also clip the link's phone press
            area. A long subject wraps instead. */}
        {todo.message.gmailHref ? (
          <GmailLink href={todo.message.gmailHref} className="press-area min-w-0">
            {todo.message.subject ?? '(no subject)'}
          </GmailLink>
        ) : (
          <span className="min-w-0">
            {todo.message.subject ?? 'An email no longer linked to this role'}
          </span>
        )}
        {/* No confirm: re-linking is one pick away, so this is reversible.
            The same unlink glyph the task rows use for detaching. */}
        <button
          type="button"
          title="Unlink the email"
          disabled={pending}
          onClick={() => save(null)}
          className="press flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors duration-quick hover:bg-sunken hover:text-ink"
        >
          <Unlink className="size-3.5" strokeWidth={1.75} aria-hidden />
          <span className="sr-only">Unlink the email</span>
        </button>
        {error && <span className="text-danger">{error}</span>}
      </p>
    );
  }

  if (!offer || messages.length === 0) return null;

  if (!picking) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setPicking(true)}>
        Link an email
      </Button>
    );
  }

  return (
    <p className="mt-1 flex flex-wrap items-center gap-2 pl-0.5 text-small">
      <Select
        aria-label="Email this to-do is about"
        defaultValue=""
        disabled={pending}
        className="max-w-full sm:max-w-md"
        onChange={(event) => {
          if (event.target.value) save(event.target.value);
        }}
      >
        <option value="">Pick an email…</option>
        {messages.map((message) => (
          <option key={message.id} value={message.id}>
            {formatDate(message.receivedAt, timezone)} — {message.subject ?? '(no subject)'}
          </option>
        ))}
      </Select>
      <Button type="button" size="sm" variant="ghost" onClick={() => setPicking(false)}>
        Cancel
      </Button>
      {error && <span className="text-danger">{error}</span>}
    </p>
  );
}
