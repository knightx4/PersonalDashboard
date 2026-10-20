'use client';

import { PenLine, Pencil, Plus, Send, Trash2, X } from 'lucide-react';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { DashAction } from '@/components/ui/dash-action';
import { EditableProse } from '@/components/ui/editable-prose';
import { ChipSelect, InlineInput, InlineTextarea, Switch, Textarea } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { linkVariants } from '@/components/ui/link';
import { Note } from '@/components/ui/note';
import { useToast } from '@/components/ui/toast';
import { ValueList, ValueRow } from '@/components/ui/value-row';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/jobs/applications/load';
import { CopyText } from '../../roles/[id]/copy-text';
import {
  deleteContact,
  deleteTouch,
  draftContactMessage,
  logTouch,
  markTouchAnswered,
  markTouchSent,
  updateContact,
  updateTouch,
  type ContactPatch,
} from '../actions';
import { RELATIONSHIPS, type ContactRow } from '../view';

const CHANNELS = ['linkedin_dm', 'linkedin_connect', 'email', 'intro', 'event', 'other'] as const;
type Channel = (typeof CHANNELS)[number];
const STATUSES = ['to_contact', 'connected', 'contacted', 'responded', 'met', 'dormant'] as const;
const DRAFT_MESSAGE = 'app/jobs/(app)/contacts/actions.ts#draftContactMessage';

const words = (value: string) => value.replace(/_/g, ' ');

/**
 * Everything about one person, in three sections: their details, each value
 * edited where it is read; the notes, read as writing until they are
 * pressed; and the outreach, where Dash drafts a message and the sends are
 * logged.
 *
 * The details used to sit behind one pencil that opened a six-field form
 * over the whole card. Now each value is its own input set like the text it
 * stands for (law 12), and leaving it saves.
 */
export function ContactDetail({
  contact: initial,
  timezone,
  preview,
}: {
  contact: ContactRow;
  timezone: string;
  /** The gallery's way to draw the outreach with a hidden part showing. */
  preview?: OutreachPreview;
}) {
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
      {/* The long text straight after the facts, then the outreach (the
          item page of the list-and-detail pattern). */}
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
      <Outreach contact={contact} setContact={setContact} timezone={timezone} preview={preview} />
      <DeleteContact contactId={contact.id} name={contact.fullName} />
    </div>
  );
}

/** Delete, asked first, at the foot of the page (note 8902b443). */
function DeleteContact({ contactId, name }: { contactId: string; name: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove() {
    setError(null);
    startTransition(async () => {
      // On success the action goes back to the list, so only a failure returns.
      const result = await deleteContact(contactId);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {confirming ? (
        <>
          <span className="text-small text-ink-muted">
            Delete {name}? Their logged sends and notes go too.
          </span>
          <Button type="button" variant="danger" size="xs" pending={pending} onClick={remove}>
            Delete
          </Button>
          <Button type="button" variant="ghost" size="xs" disabled={pending} onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <Button type="button" variant="link" className="hover:text-danger" onClick={() => setConfirming(true)}>
          Delete contact
        </Button>
      )}
      {error && (
        <p role="alert" className="w-full text-right text-small text-danger">
          {error}
        </p>
      )}
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
        <PressRoom>
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
        </PressRoom>
        <PressRoom>
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
        </PressRoom>
        {/* The two flags read as settings beside the chips, quieter than the
            facts below them, so the name is what the eye takes first. */}
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-small text-ink-muted">
          <Switch
            checked={contact.potentialLead}
            onChange={(event) => {
              const potentialLead = event.target.checked;
              save({ potentialLead }, { potentialLead });
            }}
          />
          Potential lead
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-small text-ink-muted">
          <Switch
            checked={contact.foundByDash}
            onChange={(event) => {
              const foundByDash = event.target.checked;
              save({ foundByDash }, { foundByDash });
            }}
          />
          Found by Dash
        </label>
      </div>

      <ValueList className="mt-3">
        <ValueRow
          label="Name"
          value={<DetailInput label="Name" value={contact.fullName} className="font-semibold sm:text-body" onSave={(fullName) => fullName && save({ fullName }, { fullName })} />}
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
            <div className="flex min-w-0 items-center gap-2">
              <div className="min-w-0 flex-1">
                <DetailInput
                  label="LinkedIn"
                  type="url"
                  value={contact.linkedinUrl}
                  placeholder="Add their LinkedIn page"
                  href={contact.linkedinUrl}
                  onSave={(linkedinUrl) => save({ linkedinUrl }, { linkedinUrl: linkedinUrl || null })}
                />
              </div>
              {contact.linkedinConnection && <Chip>Connected</Chip>}
            </div>
          }
        />
        <ValueRow
          label="How you connect"
          value={
            <DetailInput
              label="How you connect"
              value={contact.howWeConnect}
              placeholder="Same university, a friend's colleague…"
              wrap
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

/**
 * A chip select's press room on a phone: a label around it, as tall and wide
 * as a thumb, which counts as part of the select's target without changing
 * how the chip looks.
 */
function PressRoom({ children }: { children: React.ReactNode }) {
  return <label className="inline-flex items-center max-sm:min-h-11 max-sm:min-w-11">{children}</label>;
}

/**
 * One value, as an input set like the text it stands for; leaving it saves.
 *
 * A value that goes somewhere, a LinkedIn page or an email address, is the
 * link itself at rest, with a pencil beside it that turns it into the input
 * (note 954cc18d). It used to be an input with a small open-link icon at its
 * side, so the address could be edited in place but not pressed.
 */
function DetailInput({
  label,
  value,
  placeholder,
  type = 'text',
  href,
  wrap = false,
  className,
  onSave,
}: {
  label: string;
  value: string | null;
  placeholder?: string;
  type?: 'text' | 'email' | 'url';
  /** A sentence rather than a name: at rest it wraps as text, and pressing it opens the input (law 14). */
  wrap?: boolean;
  /** Where the value goes, opened when it is pressed. */
  href?: string | null;
  /** Added to the input, for the one fact set heavier than the rest: the name. */
  className?: string;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);

  if (href && value && !editing) {
    return (
      <span className="flex min-w-0 items-center gap-1">
        <a
          href={href}
          target={type === 'email' ? undefined : '_blank'}
          rel="noreferrer noopener"
          className={`${linkVariants()} min-w-0 truncate text-ui max-sm:py-3`}
        >
          {linkText(value)}
        </a>
        <IconButton label={`Edit ${label}`} size="sm" onClick={() => setEditing(true)}>
          <Pencil strokeWidth={1.75} aria-hidden />
        </IconButton>
      </span>
    );
  }

  if (wrap && value && !editing) {
    return (
      <button
        type="button"
        title={`Edit ${label}`}
        onClick={() => setEditing(true)}
        className="-ml-1 w-full rounded-control px-1 py-0.5 text-left text-body text-ink transition-colors duration-quick hover:bg-sunken max-sm:min-h-11 sm:text-ui"
      >
        {value}
      </button>
    );
  }

  return (
    <InlineInput
      // A new value from the server resets what the input shows.
      key={value ?? ''}
      aria-label={label}
      type={type}
      defaultValue={value ?? ''}
      placeholder={placeholder}
      autoFocus={editing}
      className={cn('-ml-1 max-sm:min-h-11', className)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          event.currentTarget.value = value ?? '';
          event.currentTarget.blur();
        }
      }}
      onBlur={(event) => {
        setEditing(false);
        const next = event.currentTarget.value.trim();
        if (next !== (value ?? '')) onSave(next);
      }}
    />
  );
}

/** A link as it reads: "linkedin.com/in/someone", without the scheme or the www. */
function linkText(value: string): string {
  return value.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
}

/**
 * How the gallery holds a part of the outreach open that a person only sees
 * after doing something: the composer, a draft's controls as hover shows
 * them, and the line a failed draft action leaves under it.
 */
export interface OutreachPreview {
  compose?: { by: Composer['by']; subject?: string; message: string };
  /** The line saying what the message is for, open as a press of Draft a message leaves it. */
  brief?: boolean;
  revealDraftId?: string;
  draftError?: { id: string; text: string };
}

/** The message being written: Dash's draft, or one typed from blank. */
interface Composer {
  by: 'dash' | 'you';
  subject: string;
  message: string;
}

type Touch = ContactRow['touches'][number];

/** Newest first, the order the log has always read in. */
const newestFirst = (a: Touch, b: Touch) => b.sentAt.localeCompare(a.sentAt);

/**
 * Drafting a message, the drafts kept for later and the log of what was sent.
 * A message, Dash's or typed, sits above the log until it is logged as sent,
 * which writes it into the log with its words, kept as a draft, or put away.
 * Drafts sit in their own list above the log and count for nothing until
 * they are marked sent. A send made some other way is logged with one press
 * and described on its own line afterwards.
 */
function Outreach({
  contact,
  setContact,
  timezone,
  preview,
}: {
  contact: ContactRow;
  setContact: React.Dispatch<React.SetStateAction<ContactRow>>;
  timezone: string;
  preview?: OutreachPreview;
}) {
  // The send just logged, whose words are where the caret goes next.
  const [freshId, setFreshId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  // Drafts are not sends: they are listed apart and left out of the count
  // in the heading, the unanswered count and the channel the next send takes.
  const drafts = contact.touches.filter((t) => t.draft).sort(newestFirst);
  const sends = contact.touches.filter((t) => !t.draft).sort(newestFirst);
  const outbound = sends.filter((t) => t.direction === 'outbound');
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
  // The line saying what the message is for opens with the first press of
  // Draft a message, so the section opens on two controls and no empty box
  // (law 14). It stays open while Dash's draft is showing, for Draft again.
  const [briefOpen, setBriefOpen] = useState(preview?.brief ?? false);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [composer, setComposer] = useState<Composer | null>(
    preview?.compose ? { subject: '', ...preview.compose } : null,
  );
  // What went wrong on one draft, said under it.
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(preview?.draftError ?? null);

  function patchTouch(id: string, patch: Partial<Touch>) {
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
      setComposer({ by: 'dash', subject: result.draft.subject ?? '', message: result.draft.message });
    } catch {
      setDraftError('Drafting stopped before it finished. Try again.');
    } finally {
      setDrafting(false);
    }
  }

  /**
   * Logs a send now on `on`, with its words when there are any, or keeps
   * them as a draft when `asDraft` is set.
   */
  function log(on: Channel, message?: string, after?: () => void, asDraft = false) {
    startTransition(async () => {
      setNote(null);
      const result = await logTouch({ contactId: contact.id, channel: on, direction: 'outbound', message, draft: asDraft });
      if (result.error || !result.touch) {
        setNote(result.error ?? (asDraft ? 'Could not save that draft.' : 'Could not log that send.'));
        return;
      }
      const touch = result.touch;
      if (!message && !asDraft) setFreshId(touch.id);
      setContact((current) => ({
        ...current,
        status:
          !asDraft && (current.status === 'to_contact' || current.status === 'connected')
            ? 'contacted'
            : current.status,
        touches: [touch, ...current.touches],
      }));
      after?.();
    });
  }

  /** The draft becomes a send, at the time it is marked; put back if that fails. */
  function markSent(draft: Touch) {
    const before = contact;
    setRowError(null);
    setContact((current) => ({
      ...current,
      status: current.status === 'to_contact' || current.status === 'connected' ? 'contacted' : current.status,
      touches: current.touches.map((t) =>
        t.id === draft.id ? { ...t, draft: false, sentAt: new Date().toISOString() } : t,
      ),
    }));
    startTransition(async () => {
      const result = await markTouchSent(draft.id);
      if (result.error) {
        setContact(before);
        setRowError({ id: draft.id, text: `Not marked sent: ${result.error}` });
        return;
      }
      if (result.sentAt) patchTouch(draft.id, { sentAt: result.sentAt });
    });
  }

  /**
   * A draft goes without asking, since Undo brings it back: the same words
   * on the same channel, saved again as a draft.
   */
  function removeDraft(draft: Touch) {
    setRowError(null);
    setContact((current) => ({ ...current, touches: current.touches.filter((t) => t.id !== draft.id) }));
    startTransition(async () => {
      const result = await deleteTouch(draft.id);
      if (result.error) {
        setContact((current) => ({ ...current, touches: [draft, ...current.touches] }));
        setRowError({ id: draft.id, text: `Not deleted: ${result.error}` });
        return;
      }
      toast({
        text: 'Draft deleted',
        undone: 'Draft back',
        undo: async () => {
          const back = await logTouch({
            contactId: contact.id,
            channel: draft.channel as Channel,
            direction: 'outbound',
            message: draft.message ?? undefined,
            draft: true,
          });
          if (back.error || !back.touch) throw new Error(back.error ?? 'Not saved');
          const restored = back.touch;
          setContact((current) => ({ ...current, touches: [restored, ...current.touches] }));
        },
      });
    });
  }

  const showBrief = briefOpen || composer?.by === 'dash';

  const composed = composer
    ? composer.subject.trim()
      ? `Subject: ${composer.subject.trim()}\n\n${composer.message}`
      : composer.message
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
      {/* Drafting: the channel and the press; once pressed, what it is for
          in a line, and the press that drafts. */}
      <div className="flex flex-wrap items-center gap-2">
        <PressRoom>
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
        </PressRoom>
        {showBrief ? (
          <>
            <InlineInput
              aria-label="What the message is for"
              value={aim}
              autoFocus={!preview && !composer}
              onChange={(event) => setAim(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !drafting) void runDraft();
              }}
              placeholder="What it's for, if you want to say: ask about the role, follow up…"
              className="min-w-48 flex-1 max-sm:min-h-11"
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
              {drafting ? 'Drafting…' : composer?.by === 'dash' ? 'Draft again' : 'Draft it'}
            </DashAction>
            {!composer && !drafting && (
              <IconButton label="Close" size="sm" onClick={() => setBriefOpen(false)}>
                <X strokeWidth={1.75} aria-hidden />
              </IconButton>
            )}
          </>
        ) : (
          <Button type="button" size="sm" variant="secondary" onClick={() => setBriefOpen(true)}>
            Draft a message
          </Button>
        )}
      </div>

      {draftError && !drafting && (
        <p role="alert" className="mt-1.5 text-small text-danger">
          Drafting failed: {draftError}
        </p>
      )}

      {composer && (
        <Note tone="accent" glyph={false} className="mt-3 space-y-2 px-3 py-2">
          <p className="text-small text-ink-muted">
            {composer.by === 'dash'
              ? `Dash's draft, as ${words(channel)}. Edit it here, send it yourself, then log it, or keep it as a draft for later.`
              : `Your message, as ${words(channel)}. Log it once you have sent it, or keep it as a draft for later.`}
          </p>
          {channel === 'email' && (
            <InlineInput
              aria-label="Subject"
              value={composer.subject}
              placeholder="Subject"
              onChange={(event) => setComposer({ ...composer, subject: event.target.value })}
              className="font-medium"
            />
          )}
          <Textarea
            aria-label="The message"
            rows={6}
            value={composer.message}
            placeholder="What you want to say"
            autoFocus={composer.by === 'you' && !preview}
            onChange={(event) => setComposer({ ...composer, message: event.target.value })}
          />
          {channel === 'linkedin_connect' && (
            <p className="tabular text-small text-ink-muted">
              {composer.message.length} of 300 characters
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              pending={pending}
              disabled={!composed.trim()}
              onClick={() => log(channel, composed, () => setComposer(null))}
            >
              Log as sent
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending || !composed.trim()}
              onClick={() => log(channel, composed, () => setComposer(null), true)}
            >
              Save as draft
            </Button>
            <CopyText text={composed} what="message" />
            <IconButton label="Put away" size="sm" onClick={() => setComposer(null)}>
              <X strokeWidth={1.75} aria-hidden />
            </IconButton>
          </div>
        </Note>
      )}

      {drafts.length > 0 && (
        <section aria-label="Drafts" className="mt-3">
          <h3 className="text-small font-medium text-ink-muted">
            Not sent yet
          </h3>
          <ul className="mt-1 divide-y divide-border border-t border-border">
            {drafts.map((draft) => (
              <DraftRow
                key={draft.id}
                draft={draft}
                timezone={timezone}
                disabled={pending}
                revealed={preview?.revealDraftId === draft.id}
                error={rowError?.id === draft.id ? rowError.text : null}
                onChannel={(next) => {
                  patchTouch(draft.id, { channel: next });
                  startTransition(async () => {
                    const result = await updateTouch(draft.id, { channel: next });
                    if (result.error) setRowError({ id: draft.id, text: result.error });
                  });
                }}
                onWords={(message) => {
                  if (message === (draft.message ?? '')) return;
                  patchTouch(draft.id, { message: message || null });
                  startTransition(async () => {
                    const result = await updateTouch(draft.id, { message });
                    if (result.error) setRowError({ id: draft.id, text: result.error });
                  });
                }}
                onMarkSent={() => markSent(draft)}
                onDelete={() => removeDraft(draft)}
              />
            ))}
          </ul>
        </section>
      )}

      {/* Logging a send made some other way is one press: it records the
          send now, on the channel the last one went out on, and the new line
          in the log is where its channel and words are filled in (law 12).
          Writing one to keep opens the same box Dash's draft does, empty. */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button type="button" size="sm" variant="ghost" pending={pending} onClick={() => log(lastChannel)}>
          <Plus className="size-4" strokeWidth={1.75} aria-hidden />
          Log a send
        </Button>
        {!composer && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setComposer({ by: 'you', subject: '', message: '' })}
          >
            <PenLine className="size-4" strokeWidth={1.75} aria-hidden />
            Write a message
          </Button>
        )}
        {note && <span className="text-small text-ink-muted">{note}</span>}
      </div>

      {sends.length > 0 ? (
        <ul className="mt-2 divide-y divide-border border-t border-border">
          {sends.map((touch) => (
            <li key={touch.id} className="row-pad flex flex-wrap items-center gap-2 text-ui">
              {/* The date's column is narrower on a phone, and the word
                  outbound goes there (most sends are), so the date, channel,
                  reply state and bin keep to one line at 390. */}
              <span className="tabular w-24 text-ink-muted max-sm:w-12">{formatDate(touch.sentAt, timezone)}</span>
              <PressRoom>
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
              </PressRoom>
              <span className={cn('text-ink-muted', touch.direction === 'outbound' && 'max-sm:sr-only')}>
                {touch.direction}
              </span>
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
              <RemoveSend
                disabled={pending}
                onRemove={() =>
                  startTransition(async () => {
                    const result = await deleteTouch(touch.id);
                    if (result.error) {
                      setNote(result.error);
                      return;
                    }
                    setContact((current) => ({
                      ...current,
                      touches: current.touches.filter((t) => t.id !== touch.id),
                    }));
                  })
                }
              />
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
 * One kept draft: labelled a draft with the day it was saved, its channel and
 * words edited where they are read as a send's are, and Mark sent and Delete
 * at the end of its first line. Those two show on hover or focus with a
 * mouse, and always on a touch screen, which has no hover.
 */
function DraftRow({
  draft,
  timezone,
  disabled,
  revealed,
  error,
  onChannel,
  onWords,
  onMarkSent,
  onDelete,
}: {
  draft: Touch;
  timezone: string;
  disabled: boolean;
  /** Held showing, as hover shows it (the gallery). */
  revealed: boolean;
  error: string | null;
  onChannel: (next: Channel) => void;
  onWords: (message: string) => void;
  onMarkSent: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="group/draft row-pad flex flex-wrap items-center gap-2 text-ui">
      {/* Drawn in ink with a pencil, since a draft is a state and not a
          colour (law 4); the day is when it was saved. */}
      <span className="tabular inline-flex items-center gap-1 text-ink-muted">
        <PenLine className="size-3.5" strokeWidth={1.75} aria-hidden />
        {/* On a phone the pencil and the list's heading say draft, which
            leaves the line room for Mark sent in words. */}
        <span className="font-medium text-ink max-sm:sr-only">Draft</span>
        <span aria-hidden className="max-sm:hidden">·</span>
        <span>{formatDate(draft.sentAt, timezone)}</span>
      </span>
      <PressRoom>
        <ChipSelect
          aria-label="How it will go out"
          value={draft.channel}
          onChange={(event) => onChannel(event.target.value as Channel)}
        >
          {CHANNELS.map((entry) => (
            <option key={entry} value={entry}>
              {words(entry)}
            </option>
          ))}
        </ChipSelect>
      </PressRoom>
      <span
        className={cn(
          'ml-auto flex items-center gap-1 transition-opacity duration-quick',
          // A phone is a touch screen, whose shots have no coarse pointer to
          // say so: below the phone break they show as on touch.
          'group-hover/draft:opacity-100 group-focus-within/draft:opacity-100 pointer-coarse:opacity-100 max-sm:opacity-100',
          revealed ? 'opacity-100' : 'opacity-0',
        )}
      >
        {/* Mark sent in words at every width (spec R20), so the draft
            stays two lines: its label and its words. */}
        <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onMarkSent}>
          <Send className="size-4" strokeWidth={1.75} aria-hidden />
          Mark sent
        </Button>
        <IconButton label="Delete this draft" size="sm" disabled={disabled} onClick={onDelete}>
          <Trash2 strokeWidth={1.75} aria-hidden />
        </IconButton>
      </span>
      <SendWords message={draft.message} startEditing={false} placeholder="The message, when you write it" onSave={onWords} />
      {error && (
        <p role="alert" className="basis-full text-small text-danger">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * Taking a send out of the log, at the end of its first line (note 0e5c4181).
 * The bin asks first, on the same line, since a send logged by mistake is
 * one press away from one logged on purpose.
 */
function RemoveSend({ disabled, onRemove }: { disabled: boolean; onRemove: () => void }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <IconButton label="Remove this send" size="sm" className="ml-auto" disabled={disabled} onClick={() => setConfirming(true)}>
        <Trash2 strokeWidth={1.75} aria-hidden />
      </IconButton>
    );
  }

  return (
    <span className="ml-auto flex items-center gap-1">
      <span className="text-small text-ink-muted">Remove it?</span>
      <Button
        type="button"
        variant="danger"
        size="xs"
        pending={disabled}
        onClick={() => {
          setConfirming(false);
          onRemove();
        }}
      >
        Remove
      </Button>
      <Button type="button" variant="ghost" size="xs" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </span>
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
  placeholder = 'What you said, roughly',
  onSave,
}: {
  message: string | null;
  startEditing: boolean;
  placeholder?: string;
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
        /* ui-ok: the words are the button that opens their editor, so a link inside would nest one press in another */
        className={`${box} whitespace-pre-line rounded-control px-1 py-0.5 text-left text-ui transition-colors duration-quick hover:bg-sunken ${message ? 'text-ink-muted' : 'text-ink-ghost'}`}
      >
        {message || placeholder}
      </button>
    );
  }

  return (
    <InlineTextarea
      aria-label="What you said"
      defaultValue={message ?? ''}
      placeholder={placeholder}
      autoFocus
      className={`${box} text-ink-muted`}
      onBlur={(event) => {
        setEditing(false);
        onSave(event.currentTarget.value.trim());
      }}
    />
  );
}
