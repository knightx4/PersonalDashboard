'use client';

import Link from 'next/link';
import { Pencil } from 'lucide-react';
import { useActionState, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/field';
import { formatDate } from '@/lib/jobs/applications/load';
import { createContact, logTouch, markTouchAnswered, updateContact } from './actions';

const RELATIONSHIPS = [
  'cold',
  'alum',
  'second_degree',
  'former_colleague',
  'friend',
  'recruiter',
  'interviewer',
] as const;

const CHANNELS = ['linkedin_dm', 'linkedin_connect', 'email', 'intro', 'event', 'other'] as const;

export interface ContactRow {
  id: string;
  fullName: string;
  title: string | null;
  relationship: string;
  status: string;
  linkedinUrl: string | null;
  email: string | null;
  howWeConnect: string | null;
  notes: string | null;
  companyName: string | null;
  companySlug: string | null;
  touches: Array<{
    id: string;
    channel: string;
    direction: string;
    sentAt: string;
    respondedAt: string | null;
    message: string | null;
  }>;
}

export function ContactsView({
  contacts,
  companies,
  timezone,
}: {
  contacts: ContactRow[];
  companies: Array<{ id: string; name: string }>;
  timezone: string;
}) {
  const [state, action] = useActionState(createContact, {});

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="rounded-card border border-border bg-surface p-4 lg:order-2">
        <h2 className="text-[13px] font-semibold text-ink">Add someone</h2>
        <form action={action} className="mt-3 space-y-3">
          <div>
            <Label htmlFor="fullName">Name</Label>
            <Input id="fullName" name="fullName" required />
          </div>
          <div>
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" placeholder="Head of Finance" />
          </div>
          <div>
            <Label htmlFor="companyId">Company</Label>
            <Select id="companyId" name="companyId" defaultValue="">
              <option value="">Not attached</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="relationship">Relationship</Label>
            <Select id="relationship" name="relationship" defaultValue="cold">
              {RELATIONSHIPS.map((entry) => (
                <option key={entry} value={entry}>
                  {entry.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="howWeConnect">How you connect</Label>
            <Input id="howWeConnect" name="howWeConnect" placeholder="Same university, 2016" />
          </div>
          <div>
            <Label htmlFor="linkedinUrl">LinkedIn</Label>
            <Input id="linkedinUrl" name="linkedinUrl" type="url" />
          </div>
          <div>
            <Label htmlFor="email">Work email</Label>
            <Input id="email" name="email" type="email" />
          </div>

          {state.error && (
            <p role="alert" className="text-[13px] text-status-rejected">
              {state.error}
            </p>
          )}
          {state.message && <p className="text-[13px] text-status-offer">{state.message}</p>}

          <Button type="submit" size="sm">
            Add contact
          </Button>
          <p className="text-[11px] leading-relaxed text-ink-faint">
            Name, title, public professional URL, work email. Nothing else, and nothing scraped —
            this is the part of the app most worth being careful with.
          </p>
        </form>
      </section>

      <div className="space-y-3 lg:col-span-2">
        {contacts.length === 0 ? (
          <p className="rounded-card border border-dashed border-border bg-surface px-4 py-10 text-center text-[13px] text-ink-muted">
            Nobody yet.
          </p>
        ) : (
          contacts.map((contact) => (
            <ContactCard key={contact.id} contact={contact} timezone={timezone} />
          ))
        )}
      </div>
    </div>
  );
}

function ContactCard({ contact: initial, timezone }: { contact: ContactRow; timezone: string }) {
  const [contact, setContact] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>('linkedin_dm');
  const [message, setMessage] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const outbound = contact.touches.filter((t) => t.direction === 'outbound');
  const pendingReply = outbound.filter((t) => t.respondedAt === null);

  return (
    <article id={`contact-${contact.id}`} className="rounded-card border border-border bg-surface p-4">
      <header className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-[13px] font-semibold text-ink">{contact.fullName}</h3>
        {contact.title && <span className="text-[12px] text-ink-muted">{contact.title}</span>}
        {contact.companySlug && (
          <Link
            href={`/jobs/companies/${contact.companySlug}`}
            className="text-[12px] text-brand hover:underline"
          >
            {contact.companyName}
          </Link>
        )}
        <span className="rounded-full bg-canvas px-1.5 py-0.5 text-[11px] text-ink-muted">
          {contact.relationship.replace(/_/g, ' ')}
        </span>
        <span className="ml-auto text-[11px] text-ink-faint">
          {contact.status.replace(/_/g, ' ')}
        </span>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-ink-faint hover:text-ink"
            title="Add or edit their details"
          >
            <Pencil className="size-3.5" strokeWidth={1.75} aria-hidden />
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
            <p className="mt-1 text-[12px] text-ink-muted">{contact.howWeConnect}</p>
          )}
          <div className="mt-1 flex flex-wrap gap-3 text-[12px]">
            {contact.linkedinUrl && (
              <a
                href={contact.linkedinUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-brand underline underline-offset-2"
              >
                LinkedIn
              </a>
            )}
            {contact.email && <span className="text-ink-muted">{contact.email}</span>}
          </div>
          {contact.notes && <p className="mt-1 text-[12px] text-ink-muted">{contact.notes}</p>}
        </>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="w-40">
          <Label htmlFor={`channel-${contact.id}`}>Log a send</Label>
          <Select
            id={`channel-${contact.id}`}
            value={channel}
            onChange={(event) => setChannel(event.target.value as (typeof CHANNELS)[number])}
          >
            {CHANNELS.map((entry) => (
              <option key={entry} value={entry}>
                {entry.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </div>
        <Input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="What you said, roughly"
          className="min-w-48 flex-1"
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await logTouch({
                contactId: contact.id,
                channel,
                direction: 'outbound',
                message,
              });
              setNote(result.error ?? 'Logged.');
              if (!result.error) setMessage('');
            })
          }
        >
          Log
        </Button>
        {note && <span className="text-[12px] text-ink-muted">{note}</span>}
      </div>

      {contact.touches.length > 0 && (
        <ul className="mt-3 divide-y divide-border border-t border-border">
          {contact.touches.slice(0, 5).map((touch) => (
            <li key={touch.id} className="flex flex-wrap items-center gap-2 py-1.5 text-[12px]">
              <span className="tabular w-24 text-ink-faint">
                {formatDate(touch.sentAt, timezone)}
              </span>
              <span className="text-ink-muted">{touch.channel.replace(/_/g, ' ')}</span>
              <span className="text-ink-faint">{touch.direction}</span>
              {touch.message && (
                <span className="min-w-0 flex-1 truncate text-ink-muted">{touch.message}</span>
              )}
              {touch.respondedAt ? (
                <span className="text-status-offer">replied</span>
              ) : touch.direction === 'outbound' ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await markTouchAnswered(touch.id, '');
                      setNote(result.error ?? 'Marked as answered.');
                    })
                  }
                >
                  They replied
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {pendingReply.length > 0 && (
        <p className="mt-2 text-[11px] text-ink-faint">
          {pendingReply.length} send{pendingReply.length === 1 ? '' : 's'} still unanswered.
        </p>
      )}
    </article>
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
        <div>
          <Label htmlFor={`name-${contact.id}`}>Name</Label>
          <Input
            id={`name-${contact.id}`}
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor={`title-${contact.id}`}>Title</Label>
          <Input
            id={`title-${contact.id}`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor={`linkedin-${contact.id}`}>LinkedIn</Label>
          <Input
            id={`linkedin-${contact.id}`}
            type="url"
            value={linkedinUrl}
            onChange={(event) => setLinkedinUrl(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor={`email-${contact.id}`}>Work email</Label>
          <Input
            id={`email-${contact.id}`}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
      </div>
      <div>
        <Label htmlFor={`connect-${contact.id}`}>How you connect</Label>
        <Input
          id={`connect-${contact.id}`}
          value={howWeConnect}
          onChange={(event) => setHowWeConnect(event.target.value)}
        />
      </div>
      <div>
        <Label htmlFor={`notes-${contact.id}`}>Notes</Label>
        <Textarea
          id={`notes-${contact.id}`}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={2}
        />
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-status-rejected">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={save}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
