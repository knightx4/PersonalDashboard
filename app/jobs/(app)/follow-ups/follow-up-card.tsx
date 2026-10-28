'use client';

import { useId, useState, useTransition } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { ActionMenu } from '@/components/ui/action-menu';
import { CardSection } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DashAction } from '@/components/ui/dash-action';
import { IconButton } from '@/components/ui/icon-button';
import { Input, PressLabel, Select, Textarea } from '@/components/ui/field';
import Link, { linkVariants } from '@/components/ui/link';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/jobs/applications/load';
import type { FollowUp, OutreachPerson } from '@/lib/jobs/followup/load';
import { linkedinSearchUrl } from '@/lib/jobs/suggest/payload';
import { CopyText } from '../roles/[id]/copy-text';
import { markTouchSent } from '../contacts/actions';
import {
  addFollowUpPerson,
  findFollowUp,
  redraftFollowUp,
  removeFollowUpPerson,
  saveFollowUpChannel,
  saveFollowUpNote,
  writeOwnFollowUp,
} from './actions';

const FIND = 'app/jobs/(app)/follow-ups/actions.ts#findFollowUp';
const REDRAFT = 'app/jobs/(app)/follow-ups/actions.ts#redraftFollowUp';

const CHANNEL_WORDS: Record<string, string> = {
  linkedin_dm: 'LinkedIn message',
  linkedin_connect: 'LinkedIn connection note',
  email: 'Email',
  intro: 'Introduction',
  event: 'In person',
  other: 'Message',
};

/** The ways a note can go, in the order the picker offers them: a LinkedIn message first. */
const NOTE_CHANNELS = ['linkedin_dm', 'email', 'linkedin_connect', 'intro', 'event', 'other'] as const;

export type CompanyContact = { id: string; name: string; title: string | null };

type Result = { error: string | null; note?: string; followUp?: FollowUp };

/**
 * The people an application is followed up with and the note to each, on
 * the role page's Outreach tab and in the Follow-ups list (lib/jobs/followup).
 * Each note is a draft on its contact: edited here, copied out, and marked
 * sent once it goes, which logs the send on the contact as every draft does.
 *
 * Dash finds the best person, or one more; the person can also link one of
 * their contacts at the company or add someone new, as many as they want.
 * Naming someone by hand costs nothing and writes no note; Dash's draft or
 * a blank one follows.
 */
export function FollowUpCard({
  initial,
  contacts = [],
  timezone,
  heading = 'People to reach out to',
  channelMenuOpen = false,
}: {
  initial: FollowUp;
  /** For the gallery: the first note's channel menu drawn open. */
  channelMenuOpen?: boolean;
  /** The person's contacts at the company, to link one by hand. */
  contacts?: readonly CompanyContact[];
  timezone: string;
  /** The card's title: the role itself in the Follow-ups list. */
  heading?: React.ReactNode;
}) {
  const [followUp, setFollowUp] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  // The fields for someone not on file, open while they are typed.
  const [adding, setAdding] = useState(false);
  const [newPerson, setNewPerson] = useState({ name: '', title: '', linkedinUrl: '' });
  const [working, setWorking] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const linkId = useId();

  const named = new Set(followUp.people.map((p) => p.contactId));
  const others = contacts.filter((c) => !named.has(c.id));
  const busy = working !== null;
  const none = followUp.people.length === 0;

  function run(kind: string, call: () => Promise<Result>, after?: () => void) {
    setWorking(kind);
    setError(null);
    startTransition(async () => {
      try {
        const result = await call();
        if (result.followUp) setFollowUp(result.followUp);
        setError(result.error ?? result.note ?? null);
        if (!result.error) after?.();
      } catch {
        setError('That stopped before it finished. Try again.');
      } finally {
        setWorking(null);
      }
    });
  }

  function patchPerson(contactId: string, patch: Partial<OutreachPerson>) {
    setFollowUp((f) => ({ ...f, people: f.people.map((p) => (p.contactId === contactId ? { ...p, ...patch } : p)) }));
  }

  return (
    <CardSection title={heading} padding="standard">
      <div className="space-y-4">
        {none && (
          <p className="text-ui text-ink-muted">
            {followUp.triedAt
              ? `Nobody named yet. Dash last looked on ${formatDate(followUp.triedAt, timezone)}.`
              : 'Nobody named yet.'}
          </p>
        )}

        {!none && (
          <ul className="divide-y divide-border">
            {followUp.people.map((person) => (
              <li key={`${person.contactId}:${person.draft?.id ?? ''}:${person.draft?.message ?? ''}`} className="py-3 first:pt-0">
                <PersonBlock
                  person={person}
                  applicationId={followUp.applicationId}
                  company={followUp.company}
                  timezone={timezone}
                  busy={busy}
                  working={working}
                  onRun={(kind, call) => run(kind, call)}
                  onPatch={(patch) => patchPerson(person.contactId, patch)}
                  onError={setError}
                  channelMenuOpen={channelMenuOpen && person === followUp.people.find((p) => p.draft)}
                />
              </li>
            ))}
          </ul>
        )}

        <div className={cn('space-y-2', !none && 'border-t border-border pt-3')}>
          <div className="flex flex-wrap items-center gap-2">
            <DashAction
              size="sm"
              variant={none ? 'primary' : 'ghost'}
              paid={FIND}
              pending={working === 'find'}
              disabled={busy}
              onClick={() => run('find', () => findFollowUp(followUp.applicationId, !none))}
            >
              {working === 'find' ? 'Looking' : none ? 'Find the best person' : 'Find another person'}
            </DashAction>
            {others.length > 0 && (
              <div className="relative max-w-full">
                <PressLabel htmlFor={linkId} />
                <Select
                  id={linkId}
                  aria-label="Link one of your contacts"
                  value=""
                  disabled={busy}
                  className="relative w-auto max-w-full"
                  onChange={(event) => {
                    const contactId = event.target.value;
                    if (contactId) run('link', () => addFollowUpPerson(followUp.applicationId, { contactId }));
                  }}
                >
                  <option value="">{working === 'link' ? 'Saving' : 'Link one of your contacts'}</option>
                  {others.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title ? `${c.name}, ${c.title}` : c.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            {!adding && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAdding(true)}>
                Add someone
              </Button>
            )}
          </div>

          {adding && (
            <form
              className="grid gap-2 sm:grid-cols-3"
              onSubmit={(event) => {
                event.preventDefault();
                run('add', () => addFollowUpPerson(followUp.applicationId, newPerson), () => {
                  setAdding(false);
                  setNewPerson({ name: '', title: '', linkedinUrl: '' });
                });
              }}
            >
              <Input
                aria-label="Name"
                placeholder="Name"
                required
                autoFocus
                value={newPerson.name}
                onChange={(event) => setNewPerson({ ...newPerson, name: event.target.value })}
              />
              <Input
                aria-label="Title"
                placeholder="Title, such as Recruiter"
                value={newPerson.title}
                onChange={(event) => setNewPerson({ ...newPerson, title: event.target.value })}
              />
              <Input
                aria-label="LinkedIn link"
                placeholder="LinkedIn link"
                type="url"
                value={newPerson.linkedinUrl}
                onChange={(event) => setNewPerson({ ...newPerson, linkedinUrl: event.target.value })}
              />
              <div className="flex gap-2 sm:col-span-3">
                <Button size="sm" type="submit" pending={working === 'add'} disabled={busy || !newPerson.name.trim()}>
                  Add to the list
                </Button>
                <Button size="sm" variant="ghost" type="button" disabled={busy} onClick={() => setAdding(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>

        {error && <p className="text-small text-danger" role="alert">{error}</p>}
      </div>
    </CardSection>
  );
}

/** One person on the list: who, why, and the note to them. */
function PersonBlock({
  person,
  applicationId,
  company,
  timezone,
  busy,
  working,
  onRun,
  onPatch,
  onError,
  channelMenuOpen,
}: {
  person: OutreachPerson;
  applicationId: string;
  company: string;
  timezone: string;
  busy: boolean;
  working: string | null;
  onRun: (kind: string, call: () => Promise<Result>) => void;
  onPatch: (patch: Partial<OutreachPerson>) => void;
  onError: (text: string | null) => void;
  channelMenuOpen: boolean;
}) {
  const draft = person.draft;
  // Keyed on the note by the list, so a fresh draft from the server (Write it
  // again) starts this over with its words.
  const [text, setText] = useState(draft?.message ?? '');
  const [, startTransition] = useTransition();
  const key = (kind: string) => `${kind}:${person.contactId}`;
  const reach = person.linkedinUrl ?? linkedinSearchUrl(`${person.name} ${company}`);

  function changeChannel(channel: string) {
    if (!draft) return;
    const before = draft.channel;
    onError(null);
    onPatch({ draft: { ...draft, channel } });
    void saveFollowUpChannel(draft.id, channel).then((result) => {
      if (!result.error) return;
      onPatch({ draft: { ...draft, channel: before } });
      onError(`Not changed: ${result.error}`);
    });
  }

  function markSent() {
    if (!draft) return;
    onError(null);
    startTransition(async () => {
      const saved = text !== draft.message ? await saveFollowUpNote(draft.id, text) : { error: null };
      const result = saved.error ? saved : await markTouchSent(draft.id);
      if (result.error) return onError(`Not marked sent: ${result.error}`);
      onPatch({
        draft: null,
        sent: { id: draft.id, channel: draft.channel, sentAt: new Date().toISOString(), respondedAt: null },
      });
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <Link href={`/jobs/contacts/${person.contactId}`} className="press-area text-ui font-medium text-ink">
              {person.name}
            </Link>
            {person.title && <span className="text-small text-ink-muted">{person.title}</span>}
          </div>
          {person.why && <p className="text-small text-ink-muted">{person.why}</p>}
          <div className="flex flex-wrap gap-x-3 text-small">
            <a href={reach} target="_blank" rel="noreferrer" className={cn(linkVariants({ tone: 'quiet' }), 'press-area')}>
              {person.linkedinUrl ? 'LinkedIn profile' : 'Find them on LinkedIn'}
            </a>
            {person.email && (
              <a href={`mailto:${person.email}`} className={cn(linkVariants({ tone: 'quiet' }), 'press-area')}>
                {person.email}
              </a>
            )}
          </div>
        </div>
        <IconButton
          size="sm"
          label={`Take ${person.name} off the list`}
          disabled={busy}
          onClick={() => onRun(key('remove'), () => removeFollowUpPerson(applicationId, person.contactId))}
        >
          <X strokeWidth={1.75} aria-hidden />
        </IconButton>
      </div>

      {person.sent && (
        <p className="text-small text-ink-muted">
          {CHANNEL_WORDS[person.sent.channel] ?? 'Message'} sent {formatDate(person.sent.sentAt, timezone)}
          {person.sent.respondedAt ? ', and they answered.' : ', no reply yet.'}
        </p>
      )}

      {draft && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            {/* How it goes is yours to pick (note a790ab92); Dash starts it as a LinkedIn message. */}
            <span className="flex min-w-0 flex-wrap items-center gap-x-1 text-small text-ink-muted">
              <ActionMenu
                label={`How the note to ${person.name} goes`}
                align="start"
                defaultOpen={channelMenuOpen}
                triggerClassName="-ml-1.5 h-auto w-auto gap-1 px-1.5 py-0.5 text-small text-ink-muted"
                trigger={
                  <>
                    <span>{CHANNEL_WORDS[draft.channel] ?? 'Message'}</span>
                    <ChevronDown className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                  </>
                }
                items={NOTE_CHANNELS.map((channel) => ({
                  id: channel,
                  label: CHANNEL_WORDS[channel],
                  current: channel === draft.channel,
                  disabled: busy,
                  onSelect: () => {
                    if (channel !== draft.channel) changeChannel(channel);
                  },
                }))}
              />
              <span>not sent yet</span>
            </span>
            <CopyText text={text} what="note" />
          </div>
          <Textarea
            value={text}
            rows={6}
            aria-label={`The note to ${person.name}`}
            onChange={(event) => setText(event.target.value)}
            onBlur={() => {
              if (text === draft.message) return;
              void saveFollowUpNote(draft.id, text).then((result) => {
                if (result.error) onError(`Your edit was not kept: ${result.error}`);
                else onPatch({ draft: { ...draft, message: text } });
              });
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={markSent} disabled={busy}>
              Mark sent
            </Button>
            <DashAction
              size="sm"
              variant="secondary"
              paid={REDRAFT}
              pending={working === key('redraft')}
              disabled={busy}
              onClick={() => onRun(key('redraft'), () => redraftFollowUp(applicationId, person.contactId))}
            >
              {working === key('redraft') ? 'Writing' : 'Write it again'}
            </DashAction>
          </div>
        </div>
      )}

      {!draft && !person.sent && (
        <div className="flex flex-wrap items-center gap-2">
          <DashAction
            size="sm"
            paid={REDRAFT}
            pending={working === key('redraft')}
            disabled={busy}
            onClick={() => onRun(key('redraft'), () => redraftFollowUp(applicationId, person.contactId))}
          >
            {working === key('redraft') ? 'Writing' : 'Write the note'}
          </DashAction>
          <Button
            size="sm"
            variant="secondary"
            pending={working === key('own')}
            disabled={busy}
            onClick={() => onRun(key('own'), () => writeOwnFollowUp(applicationId, person.contactId))}
          >
            Write it yourself
          </Button>
        </div>
      )}
    </div>
  );
}
