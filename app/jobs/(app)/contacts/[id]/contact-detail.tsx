'use client';

import { ExternalLink, Plus } from 'lucide-react';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { DashAction } from '@/components/ui/dash-action';
import { EditableProse } from '@/components/ui/editable-prose';
import { ChipSelect, InlineInput, InlineTextarea, Switch, Textarea } from '@/components/ui/field';
import { Note } from '@/components/ui/note';
import { ValueList, ValueRow } from '@/components/ui/value-row';
import { formatDate } from '@/lib/jobs/applications/load';
import { CopyText } from '../../roles/[id]/copy-text';
import {
  draftContactMessage,
  logTouch,
  markTouchAnswered,
  updateContact,
  updateTouch,
  type ContactPatch,
} from '../actions';
import { RELATIONSHIPS, type ContactRow } from '../view';

const CHANNELS = ['linkedin_dm', 'linkedin_connect', 'email', 'intro', 'event', 'other'] as const;
type Channel = (typeof CHANNELS)[number];
const STATUSES = ['to_contact', 'contacted', 'responded', 'met', 'dormant'] as const;
const DRAFT_MESSAGE = 'app/jobs/(app)/contacts/actions.ts#draftContactMessage';

const words = (value: string) => value.replace(/_/g, ' ');

/**
 * Everything about one person, in three sections: their details, each value
 * edited where it is read; the outreach, where Dash drafts a message and the
 * sends are logged; and the notes, read as writing until they are pressed.
 *
 * The details used to sit behind one pencil that opened a six-field form
 * over the whole card. Now each value is its own input set like the text it
 * stands for (law 12), and leaving it saves.
 */
export function ContactDetail({ contact: initial, timezone }: { contact: ContactRow; timezone: string }) {
  const [contact, setContact] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  /** Shows the change at once and writes it; puts it back if the write fails. */
  function save(patch: ContactPatch, local: Partial<ContactRow>) {
    const before = contact;
    setContact((current) => ({ ...current, ...local }));
    setError(null);
    startTransition(async () => {
      const result = await updateContact(contact.id, patch);
      if (result.error) {
        setContact(before);
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <ContactDetails contact={contact} save={save} error={error} />
      <Outreach contact={contact} setContact={setContact} timezone={timezone} />
      <CardSection title="Notes">
        <EditableProse
          value={contact.notes ?? ''}
          label="Notes on them"
          empty="No notes yet. Why they matter, what you talked about, what to ask next."
          editLabel="Write notes"
          onSave={async (next) => {
            const result = await updateContact(contact.id, { notes: next });
            if (result.error) return result.error;
            setContact((current) => ({ ...current, notes: next.trim() || null }));
          }}
        />
      </CardSection>
    </div>
  );
}

function ContactDetails({
  contact,
  save,
  error,
}: {
  contact: ContactRow;
  save: (patch: ContactPatch, local: Partial<ContactRow>) => void;
  error: string | null;
}) {
  return (
    <Card padding="dense" data-slot="section">
      {/* The properties a list sorts and filters by, as chips on one line. */}
      <div className="flex flex-wrap items-center gap-2">
        <ChipSelect
          aria-label="How you know them"
          value={contact.relationship}
          onChange={(event) => {
            const relationship = event.target.value as (typeof RELATIONSHIPS)[number];
            save({ relationship }, { relationship });
          }}
        >
          {RELATIONSHIPS.map((entry) => (
            <option key={entry} value={entry}>
              {words(entry)}
            </option>
          ))}
        </ChipSelect>
        <ChipSelect
          aria-label="Where it stands"
          value={contact.status}
          onChange={(event) => {
            const status = event.target.value as (typeof STATUSES)[number];
            save({ status }, { status });
          }}
        >
          {STATUSES.map((entry) => (
            <option key={entry} value={entry}>
              {words(entry)}
            </option>
          ))}
        </ChipSelect>
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-ui text-ink">
          <Switch
            checked={contact.potentialLead}
            onChange={(event) => {
              const potentialLead = event.target.checked;
              save({ potentialLead }, { potentialLead });
            }}
          />
          Potential lead
        </label>
      </div>

      <ValueList className="mt-3">
        <ValueRow
          label="Name"
          value={<DetailInput label="Name" value={contact.fullName} onSave={(fullName) => fullName && save({ fullName }, { fullName })} />}
        />
        <ValueRow
          label="Title"
          value={<DetailInput label="Title" value={contact.title} placeholder="Add their title" onSave={(title) => save({ title }, { title: title || null })} />}
        />
        <ValueRow
          label="Work email"
          value={
            <DetailInput
              label="Work email"
              type="email"
              value={contact.email}
              placeholder="Add a work email"
              href={contact.email ? `mailto:${contact.email}` : null}
              onSave={(email) => save({ email }, { email: email || null })}
            />
          }
        />
        <ValueRow
          label="LinkedIn"
          value={
            <DetailInput
              label="LinkedIn"
              type="url"
              value={contact.linkedinUrl}
              placeholder="Add their LinkedIn page"
              href={contact.linkedinUrl}
              onSave={(linkedinUrl) => save({ linkedinUrl }, { linkedinUrl: linkedinUrl || null })}
            />
          }
        />
        <ValueRow
          label="How you connect"
          value={
            <DetailInput
              label="How you connect"
              value={contact.howWeConnect}
              placeholder="Same university, a friend's colleague…"
              onSave={(howWeConnect) => save({ howWeConnect }, { howWeConnect: howWeConnect || null })}
            />
          }
        />
      </ValueList>
      {error && (
        <p role="alert" className="mt-2 text-small text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}

/** One value, as an input set like the text it stands for; leaving it saves. */
function DetailInput({
  label,
  value,
  placeholder,
  type = 'text',
  href,
  onSave,
}: {
  label: string;
  value: string | null;
  placeholder?: string;
  type?: 'text' | 'email' | 'url';
  /** Where the value goes, opened beside it. */
  href?: string | null;
  onSave: (next: string) => void;
}) {
  return (
    <span className="flex items-center gap-1">
      <InlineInput
        // A new value from the server resets what the input shows.
        key={value ?? ''}
        aria-label={label}
        type={type}
        defaultValue={value ?? ''}
        placeholder={placeholder}
        className="-ml-1"
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            event.currentTarget.value = value ?? '';
            event.currentTarget.blur();
          }
        }}
        onBlur={(event) => {
          const next = event.currentTarget.value.trim();
          if (next !== (value ?? '')) onSave(next);
        }}
      />
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          title={`Open ${label}`}
          aria-label={`Open ${label}`}
          className="shrink-0 rounded-control p-1 text-ink-muted hover:bg-sunken hover:text-ink"
        >
          <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden />
        </a>
      )}
    </span>
  );
}

/**
 * Drafting a message and the log of what was sent. Dash's draft sits above
 * the log until it is logged as sent, which writes it into the log with its
 * words, or put away. A send made some other way is logged with one press and
 * described on its own line afterwards.
 */
function Outreach({
  contact,
  setContact,
  timezone,
}: {
  contact: ContactRow;
  setContact: React.Dispatch<React.SetStateAction<ContactRow>>;
  timezone: string;
}) {
  // The send just logged, whose words are where the caret goes next.
  const [freshId, setFreshId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const outbound = contact.touches.filter((t) => t.direction === 'outbound');
  const pendingReply = outbound.filter((t) => t.respondedAt === null);
  // A new send goes out the way the last one did: email when there is only
  // an address, LinkedIn otherwise.
  const lastChannel: Channel = (CHANNELS as readonly string[]).includes(outbound[0]?.channel ?? '')
    ? (outbound[0].channel as Channel)
    : contact.email && !contact.linkedinUrl
      ? 'email'
      : 'linkedin_dm';

  const [channel, setChannel] = useState<Channel>(lastChannel);
  const [aim, setAim] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ subject: string; message: string } | null>(null);

  function patchTouch(id: string, patch: Partial<ContactRow['touches'][number]>) {
    setContact((current) => ({
      ...current,
      touches: current.touches.map((touch) => (touch.id === id ? { ...touch, ...patch } : touch)),
    }));
  }

  async function runDraft() {
    setDrafting(true);
    setDraftError(null);
    try {
      const result = await draftContactMessage({ contactId: contact.id, channel, aim });
      if (result.error || !result.draft) {
        setDraftError(result.error ?? 'Nothing came back.');
        return;
      }
      setDraft({ subject: result.draft.subject ?? '', message: result.draft.message });
    } catch {
      setDraftError('Drafting stopped before it finished. Try again.');
    } finally {
      setDrafting(false);
    }
  }

  /** Logs a send now on `on`, with its words when there are any. */
  function log(on: Channel, message?: string, after?: () => void) {
    startTransition(async () => {
      setNote(null);
      const result = await logTouch({ contactId: contact.id, channel: on, direction: 'outbound', message });
      if (result.error || !result.touch) {
        setNote(result.error ?? 'Could not log that send.');
        return;
      }
      const touch = result.touch;
      if (!message) setFreshId(touch.id);
      setContact((current) => ({
        ...current,
        status: current.status === 'to_contact' ? 'contacted' : current.status,
        touches: [touch, ...current.touches],
      }));
      after?.();
    });
  }

  const draftText = draft
    ? draft.subject.trim()
      ? `Subject: ${draft.subject.trim()}\n\n${draft.message}`
      : draft.message
    : '';

  return (
    <CardSection
      title="Outreach"
      meta={
        pendingReply.length > 0
          ? `${pendingReply.length} unanswered`
          : outbound.length > 0
            ? `${outbound.length} sent`
            : undefined
      }
    >
      {/* Drafting: the channel, what it is for in a line, and the press. */}
      <div className="flex flex-wrap items-center gap-2">
        <ChipSelect
          aria-label="Draft it as"
          value={channel}
          onChange={(event) => setChannel(event.target.value as Channel)}
        >
          {CHANNELS.map((entry) => (
            <option key={entry} value={entry}>
              {words(entry)}
            </option>
          ))}
        </ChipSelect>
        <InlineInput
          aria-label="What the message is for"
          value={aim}
          onChange={(event) => setAim(event.target.value)}
          placeholder="What it's for, if you want to say: ask about the role, follow up…"
          className="min-w-48 flex-1"
        />
        <DashAction
          type="button"
          size="sm"
          variant="secondary"
          pending={drafting}
          disabled={drafting}
          paid={DRAFT_MESSAGE}
          what="Cost of drafting the message"
          onClick={() => void runDraft()}
        >
          {drafting ? 'Drafting…' : draft ? 'Draft again' : 'Draft a message'}
        </DashAction>
      </div>

      {draftError && !drafting && (
        <p role="alert" className="mt-1.5 text-small text-danger">
          Drafting failed: {draftError}
        </p>
      )}

      {draft && (
        <Note tone="accent" glyph={false} className="mt-3 space-y-2 px-3 py-2">
          <p className="text-small text-ink-muted">
            Dash&apos;s draft, as {words(channel)}. Edit it here, send it yourself, then log it.
          </p>
          {channel === 'email' && (
            <InlineInput
              aria-label="Subject"
              value={draft.subject}
              placeholder="Subject"
              onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
              className="font-medium"
            />
          )}
          <Textarea
            aria-label="The drafted message"
            rows={6}
            value={draft.message}
            onChange={(event) => setDraft({ ...draft, message: event.target.value })}
          />
          {channel === 'linkedin_connect' && (
            <p className="tabular text-small text-ink-muted">
              {draft.message.length} of 300 characters
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              pending={pending}
              onClick={() => log(channel, draftText, () => setDraft(null))}
            >
              Log as sent
            </Button>
            <CopyText text={draftText} what="message" />
            <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)}>
              Put away
            </Button>
          </div>
        </Note>
      )}

      {/* Logging a send made some other way is one press: it records the
          send now, on the channel the last one went out on, and the new line
          in the log is where its channel and words are filled in (law 12). */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button type="button" size="sm" variant="ghost" pending={pending} onClick={() => log(lastChannel)}>
          <Plus className="size-4" strokeWidth={1.75} aria-hidden />
          Log a send
        </Button>
        {note && <span className="text-small text-ink-muted">{note}</span>}
      </div>

      {contact.touches.length > 0 ? (
        <ul className="mt-2 divide-y divide-border border-t border-border">
          {contact.touches.map((touch) => (
            <li key={touch.id} className="row-pad flex flex-wrap items-center gap-2 text-ui">
              <span className="tabular w-24 text-ink-muted">{formatDate(touch.sentAt, timezone)}</span>
              <ChipSelect
                aria-label="How it went out"
                value={touch.channel}
                onChange={(event) => {
                  const next = event.target.value as Channel;
                  patchTouch(touch.id, { channel: next });
                  startTransition(async () => {
                    const result = await updateTouch(touch.id, { channel: next });
                    if (result.error) setNote(result.error);
                  });
                }}
              >
                {CHANNELS.map((entry) => (
                  <option key={entry} value={entry}>
                    {words(entry)}
                  </option>
                ))}
              </ChipSelect>
              <span className="text-ink-muted">{touch.direction}</span>
              {/* The answer stays on the first line with the date and the
                  channel, and the words take the line below, so every send
                  row has the same shape at every width. */}
              {touch.respondedAt ? (
                <span className="text-ink">replied</span>
              ) : touch.direction === 'outbound' ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await markTouchAnswered(touch.id, '');
                      if (result.error) {
                        setNote(result.error);
                        return;
                      }
                      patchTouch(touch.id, { respondedAt: new Date().toISOString() });
                      setContact((current) => ({ ...current, status: 'responded' }));
                    })
                  }
                >
                  They replied
                </Button>
              ) : null}
              <SendWords
                message={touch.message}
                startEditing={touch.id === freshId}
                onSave={(message) => {
                  if (touch.id === freshId) setFreshId(null);
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
        <p className="mt-2 text-ui text-ink-muted">Nothing logged yet.</p>
      )}
    </CardSection>
  );
}

/**
 * The words of one send, as text that wraps until it is pressed (law 14).
 *
 * An always-open input cut a long message off mid-word at 390. At rest the
 * whole message is set as writing and is the button; pressed, it becomes an
 * editor of the same size, and leaving it saves. A send just logged opens on
 * the editor, since its words are what comes next.
 */
function SendWords({
  message,
  startEditing,
  onSave,
}: {
  message: string | null;
  startEditing: boolean;
  onSave: (message: string) => void;
}) {
  const [editing, setEditing] = useState(startEditing);
  const box = 'min-w-0 basis-full';

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Edit what you said"
        className={`${box} rounded-control px-1 py-0.5 text-left text-ui transition-colors duration-quick hover:bg-sunken ${message ? 'text-ink-muted' : 'text-ink-ghost'}`}
      >
        {message || 'What you said, roughly'}
      </button>
    );
  }

  return (
    <InlineTextarea
      aria-label="What you said"
      defaultValue={message ?? ''}
      placeholder="What you said, roughly"
      autoFocus
      className={`${box} text-ink-muted`}
      onBlur={(event) => {
        setEditing(false);
        onSave(event.currentTarget.value.trim());
      }}
    />
  );
}
