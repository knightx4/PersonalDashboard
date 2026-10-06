'use client';

import { Pencil, Plus } from 'lucide-react';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChipSelect, Field, FieldError, InlineInput, Input, Textarea } from '@/components/ui/field';
import { formatDate } from '@/lib/jobs/applications/load';
import { logTouch, markTouchAnswered, updateContact, updateTouch } from '../actions';
import type { ContactRow } from '../view';

const CHANNELS = ['linkedin_dm', 'linkedin_connect', 'email', 'intro', 'event', 'other'] as const;
type Channel = (typeof CHANNELS)[number];

/**
 * Everything about one person: their details (editable), and the log of
 * sends to them, with the reply state. A send is logged with one press and
 * described on its own line afterwards. Split out of the contacts list so the
 * list can be a plain table -- this is what "click into the person" opens.
 */
export function ContactDetail({ contact: initial, timezone }: { contact: ContactRow; timezone: string }) {
  const [contact, setContact] = useState(initial);
  const [editing, setEditing] = useState(false);
  // The send just logged, whose words are where the caret goes next.
  const [freshId, setFreshId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const outbound = contact.touches.filter((t) => t.direction === 'outbound');
  const pendingReply = outbound.filter((t) => t.respondedAt === null);
  // A new send goes out the way the last one did; LinkedIn when there is none.
  const lastChannel = (CHANNELS as readonly string[]).includes(outbound[0]?.channel ?? '')
    ? (outbound[0].channel as Channel)
    : 'linkedin_dm';

  function patchTouch(id: string, patch: Partial<ContactRow['touches'][number]>) {
    setContact((current) => ({
      ...current,
      touches: current.touches.map((touch) => (touch.id === id ? { ...touch, ...patch } : touch)),
    }));
  }

  return (
    <Card padding="dense">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-body font-semibold text-ink">{contact.fullName}</h1>
        {contact.title && <span className="text-ui text-ink-muted">{contact.title}</span>}
        <span className="rounded-full bg-canvas px-1.5 py-0.5 text-small text-ink-muted">
          {contact.relationship.replace(/_/g, ' ')}
        </span>
        <span className="ml-auto text-small text-ink-muted">
          {contact.status.replace(/_/g, ' ')}
        </span>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="press flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors duration-quick hover:bg-sunken hover:text-ink"
            title="Edit their details"
          >
            <Pencil className="size-4" strokeWidth={1.75} aria-hidden />
            <span className="sr-only">Edit their details</span>
          </button>
        )}
      </header>

      {editing ? (
        <ContactEditForm
          contact={contact}
          onCancel={() => setEditing(false)}
          onSaved={(next) => {
            setContact(next);
            setEditing(false);
          }}
        />
      ) : (
        <>
          {contact.howWeConnect && (
            <p className="mt-1 text-ui text-ink-muted">{contact.howWeConnect}</p>
          )}
          <div className="mt-1 flex flex-wrap gap-3 text-ui">
            {contact.linkedinUrl && (
              <a
                href={contact.linkedinUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-accent underline underline-offset-2"
              >
                LinkedIn
              </a>
            )}
            {contact.email && <span className="text-ink-muted">{contact.email}</span>}
          </div>
          {contact.notes && <p className="mt-2 text-ui text-ink-muted">{contact.notes}</p>}
        </>
      )}

      {/* Logging a send is one press: it records the send now, on the
          channel the last one went out on, and the new line in the log is
          where its channel and words are filled in (law 12). */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          pending={pending}
          onClick={() =>
            startTransition(async () => {
              setNote(null);
              const result = await logTouch({
                contactId: contact.id,
                channel: lastChannel,
                direction: 'outbound',
              });
              if (result.error || !result.touch) {
                setNote(result.error ?? 'Could not log that send.');
                return;
              }
              const touch = result.touch;
              setFreshId(touch.id);
              setContact((current) => ({ ...current, touches: [touch, ...current.touches] }));
            })
          }
        >
          <Plus className="size-4" strokeWidth={1.75} aria-hidden />
          Log a send
        </Button>
        {note && <span className="text-small text-ink-muted">{note}</span>}
      </div>

      {contact.touches.length > 0 ? (
        <ul className="mt-3 divide-y divide-border border-t border-border">
          {contact.touches.map((touch) => (
            <li key={touch.id} className="row-pad flex flex-wrap items-center gap-2 text-ui">
              <span className="tabular w-24 text-ink-muted">
                {formatDate(touch.sentAt, timezone)}
              </span>
              <ChipSelect
                aria-label="How it went out"
                value={touch.channel}
                onChange={(event) => {
                  const channel = event.target.value as Channel;
                  patchTouch(touch.id, { channel });
                  startTransition(async () => {
                    const result = await updateTouch(touch.id, { channel });
                    if (result.error) setNote(result.error);
                  });
                }}
              >
                {CHANNELS.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry.replace(/_/g, ' ')}
                  </option>
                ))}
              </ChipSelect>
              <span className="text-ink-muted">{touch.direction}</span>
              {/* `sm:order-last` puts the answer back at the end of the row
                  where there is room for one; below `sm` it stays where the
                  DOM has it, above the message, so the line that wraps is the
                  message and not this. */}
              {touch.respondedAt ? (
                <span className="text-ink sm:order-last">replied</span>
              ) : touch.direction === 'outbound' ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="sm:order-last"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await markTouchAnswered(touch.id, '');
                      if (result.error) {
                        setNote(result.error);
                        return;
                      }
                      patchTouch(touch.id, { respondedAt: new Date().toISOString() });
                    })
                  }
                >
                  They replied
                </Button>
              ) : null}
              {/* Last in the row, so on a phone -- where it takes the whole of
                  the next line -- the date, the channel and the answer stay
                  together above it. The words are the send's own text, edited
                  where they are read; a send just logged opens on them. */}
              <InlineInput
                aria-label="What you said"
                defaultValue={touch.message ?? ''}
                placeholder="What you said, roughly"
                autoFocus={touch.id === freshId}
                className="min-w-0 basis-full text-ink-muted sm:flex-1 sm:basis-auto"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
                onBlur={(event) => {
                  if (touch.id === freshId) setFreshId(null);
                  const message = event.currentTarget.value.trim();
                  if (message === (touch.message ?? '')) return;
                  patchTouch(touch.id, { message: message || null });
                  startTransition(async () => {
                    const result = await updateTouch(touch.id, { message });
                    if (result.error) setNote(result.error);
                  });
                }}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 border-t border-border pt-3 text-ui text-ink-muted">
          Nothing logged yet.
        </p>
      )}

      {pendingReply.length > 0 && (
        <p className="mt-2 text-small text-ink-muted">
          {pendingReply.length} send{pendingReply.length === 1 ? '' : 's'} still unanswered.
        </p>
      )}
    </Card>
  );
}

/**
 * A contact created from mail arrives with only a name -- the extractor has
 * no way to know a title or a LinkedIn URL. This is the only place either
 * gets added.
 */
function ContactEditForm({
  contact,
  onCancel,
  onSaved,
}: {
  contact: ContactRow;
  onCancel: () => void;
  onSaved: (next: ContactRow) => void;
}) {
  const [fullName, setFullName] = useState(contact.fullName);
  const [title, setTitle] = useState(contact.title ?? '');
  const [linkedinUrl, setLinkedinUrl] = useState(contact.linkedinUrl ?? '');
  const [email, setEmail] = useState(contact.email ?? '');
  const [howWeConnect, setHowWeConnect] = useState(contact.howWeConnect ?? '');
  const [notes, setNotes] = useState(contact.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await updateContact(contact.id, {
        fullName,
        title,
        linkedinUrl,
        email,
        howWeConnect,
        notes,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      onSaved({
        ...contact,
        fullName,
        title: title || null,
        linkedinUrl: linkedinUrl || null,
        email: email || null,
        howWeConnect: howWeConnect || null,
        notes: notes || null,
      });
    });
  };

  return (
    <div className="mt-2 space-y-2 border-t border-border pt-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field id={`name-${contact.id}`} label="Name">
          <Input
            id={`name-${contact.id}`}
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
          />
        </Field>
        <Field id={`title-${contact.id}`} label="Title">
          <Input
            id={`title-${contact.id}`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field id={`linkedin-${contact.id}`} label="LinkedIn">
          <Input
            id={`linkedin-${contact.id}`}
            type="url"
            value={linkedinUrl}
            onChange={(event) => setLinkedinUrl(event.target.value)}
          />
        </Field>
        <Field id={`email-${contact.id}`} label="Work email">
          <Input
            id={`email-${contact.id}`}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
      </div>
      <Field id={`connect-${contact.id}`} label="How you connect">
        <Input
          id={`connect-${contact.id}`}
          value={howWeConnect}
          onChange={(event) => setHowWeConnect(event.target.value)}
        />
      </Field>
      <Field id={`notes-${contact.id}`} label="Notes">
        {/* ui-ok: composer-always-open -- ContactEditForm renders only when
          * `editing`, and that gate is in the parent component, which the rule
          * cannot see across. Law 14 is obeyed. */}
        <Textarea
          id={`notes-${contact.id}`}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={2}
        />
      </Field>
      <FieldError>{error}</FieldError>
      <div className="flex gap-2">
        <Button type="button" size="sm" pending={pending} onClick={save}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" pending={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
