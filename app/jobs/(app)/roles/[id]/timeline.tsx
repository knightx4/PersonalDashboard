'use client';

import { useState, useTransition } from 'react';
import { CalendarClock, CircleAlert, ListChecks, Mail } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { CardSection, cardVariants } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { AddTrigger } from '@/components/ui/add-trigger';
import { StatusBadge } from '@/components/jobs/ui/status-badge';
import { formatDate } from '@/lib/jobs/applications/load';
import { addReminder, linkReminderMessage, updateReminder } from './timeline-actions';
import { ReminderActions } from '@/app/jobs/(app)/_home/reminder-actions';
import { ChipInput, ComposeTitle, Input, Select } from '@/components/ui/field';
import { GmailLink } from './shared';
import type { PanelProps } from './types';

export function Timeline({
  events,
  timezone,
  otherAttempts,
  todos,
  applicationId,
  messages,
}: PanelProps) {
  return (
    <div className="space-y-4">
      <Todos todos={todos} applicationId={applicationId} timezone={timezone} messages={messages} />

      {otherAttempts.length > 0 && (
        <CardSection
          title="Earlier attempts"
          hint="Kept as history rather than overwritten — which is the whole reason a pursuit is a separate row from the posting."
        >
          <ul className="space-y-1.5">
            {otherAttempts.map((attempt) => (
              <li key={attempt.id} className="flex items-center gap-2 text-ui">
                <span className="tabular text-ink-muted">#{attempt.attempt}</span>
                <StatusBadge status={attempt.status} everSubmitted={attempt.submittedAt !== null} />
                <span className="text-ink-muted">{formatDate(attempt.submittedAt, timezone)}</span>
                {attempt.rejectionStage && (
                  <span className="text-ink-muted">at {attempt.rejectionStage}</span>
                )}
              </li>
            ))}
          </ul>
        </CardSection>
      )}

      {events.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="Nothing has happened yet"
          description="Events appear here as mail arrives, or when you move the card."
          action={{ label: 'Open the board', href: '/jobs/pipeline' }}
        />
      ) : (
        // One card of rows rather than a card per event: the tint on a row
        // that needs review is enough to single it out without its own border.
        <ol className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
          {events.map((event) => (
            <li
              key={event.id}
              className={cn(
                'card-pad-x row-pad flex gap-3',
                event.needsReview && 'bg-caution-tint',
              )}
            >
              <span className="tabular w-28 shrink-0 text-small text-ink-muted">
                {formatDate(event.occurredAt, timezone)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-ui text-ink">
                  {event.gmailHref ? (
                    <GmailLink href={event.gmailHref}>
                      {event.summary ?? event.kind.replace(/_/g, ' ')}
                    </GmailLink>
                  ) : (
                    (event.summary ?? event.kind.replace(/_/g, ' '))
                  )}
                </p>
                <p className="text-small text-ink-muted">
                  {event.kind.replace(/_/g, ' ')} · {event.source}
                </p>
                {event.needsReview && (
                  <p className="mt-1 flex items-start gap-1.5 text-small text-ink">
                    <CircleAlert
                      className="mt-0.5 size-3.5 shrink-0 text-caution"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    Recorded, but it did not change the status — that would have moved this
                    backwards.
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * Something to do, with a date, that nobody's mail is going to tell you about.
 *
 * Backed by the same `reminders` row the nightly sweep raises, so setting one
 * here is not a second system: it shows up on This week's Nudges once due,
 * and finishing it there clears it here too.
 */
function Todos({
  todos,
  applicationId,
  timezone,
  messages,
}: {
  todos: PanelProps['todos'];
  applicationId: string;
  timezone: string;
  messages: PanelProps['messages'];
}) {
  const [body, setBody] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <CardSection title="To-dos">
      {todos.length > 0 && (
        <ul className="mb-3 space-y-2">
          {todos.map((todo) => (
            <li key={todo.id} className="text-ui">
              <TodoLine todo={todo} messages={messages} timezone={timezone} />
            </li>
          ))}
        </ul>
      )}
      {/*
       * Not a form until there is something to add.
       *
       * This has been narrowed twice already -- from two labelled Fields and a
       * button down to one row -- and it was still a row of bordered controls
       * standing open under the list on every visit. The worst of them was the
       * date: a full-height box printing "dd/mm/yyyy" in ghost text, as wide
       * as a sentence, permanently empty. The section is the to-dos; a form
       * for adding one is not what you came to read (law 14).
       *
       * Open, it is a compose surface rather than a row of fields: the
       * sentence is the only thing set at full size, and the day is a chip
       * beside it carrying its own glyph in place of a caption (law 9).
       *
       * It is a real `<form>`, which is what makes Return submit it -- the
       * thing you actually do after typing a to-do.
       */}
      {adding ? (
        <form
          className="sheet flex flex-wrap items-center gap-2 rounded-card px-2.5 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!body.trim() || !dueAt) return;
            startTransition(async () => {
              const result = await addReminder({ applicationId, body, dueAt });
              setError(result.error);
              if (!result.error) {
                setBody('');
                setDueAt('');
                setAdding(false);
              }
            });
          }}
        >
          <ComposeTitle
            autoFocus
            value={body}
            onChange={(event) => setBody(event.target.value)}
            aria-label="The to-do"
            placeholder="What has to happen?"
            className="min-w-48 flex-1"
          />
          <ChipInput
            type="date"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
            aria-label="Done by"
            icon={<CalendarClock className="size-3.5" strokeWidth={1.75} />}
          />
          <Button type="submit" size="sm" pending={pending} disabled={!body.trim() || !dueAt}>
            Add
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setBody('');
              setDueAt('');
              setError(null);
              setAdding(false);
            }}
          >
            Cancel
          </Button>
          {error && <span className="text-small text-danger">{error}</span>}
        </form>
      ) : (
        <AddTrigger label="Add a to-do" onClick={() => setAdding(true)} />
      )}
    </CardSection>
  );
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
  todo: PanelProps['todos'][number];
  messages: PanelProps['messages'];
  timezone: string;
}) {
  const [editing, setEditing] = useState(false);
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
      /* The to-do first, its date after it, the two answers at the end.
       *
       * It used to be a date column, then the words, then Edit, then Later,
       * then Done, then "Link an email" underneath -- three lines for one
       * to-do at 390px, because `ReminderActions` pushes itself right with
       * `ml-auto` and a fixed-width date column had already spent a third of
       * the row. The date is metadata about the sentence, not a column heading
       * for it, so it reads small and after it, the way every other date in
       * this module does.
       *
       * Below `sm` the sentence keeps the whole line and the buttons take the
       * next one. Sharing a line with them only meant the to-do broke across
       * two lines around them, which is a worse two lines than these. */
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="min-w-0 basis-full text-ink sm:basis-auto sm:flex-1">
          {todo.body}
          <span className="tabular ml-2 text-small text-ink-muted">
            {formatDate(todo.dueAt, timezone)}
          </span>
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={open}>
            Edit
          </Button>
          <ReminderActions id={todo.id} />
        </span>
        <TodoMail todo={todo} messages={messages} timezone={timezone} offer={false} />
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
  todo: PanelProps['todos'][number];
  messages: PanelProps['messages'];
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
      <p className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-small text-ink-muted">
        <Mail className="size-3.5 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
        {todo.message.gmailHref ? (
          <GmailLink href={todo.message.gmailHref}>
            {todo.message.subject ?? '(no subject)'}
          </GmailLink>
        ) : (
          <span>{todo.message.subject ?? 'An email no longer linked to this role'}</span>
        )}
        {/* No confirm: re-linking is one pick away, so this is reversible. */}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => save(null)}
        >
          Unlink
        </Button>
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
