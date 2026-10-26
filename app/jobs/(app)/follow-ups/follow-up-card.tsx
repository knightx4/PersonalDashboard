'use client';

import { useState, useTransition } from 'react';
import { CardSection } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DashAction } from '@/components/ui/dash-action';
import { Select, Textarea } from '@/components/ui/field';
import Link, { linkVariants } from '@/components/ui/link';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/jobs/applications/load';
import type { FollowUp } from '@/lib/jobs/followup/load';
import { linkedinSearchUrl } from '@/lib/jobs/suggest/payload';
import { CopyText } from '../roles/[id]/copy-text';
import { markTouchSent } from '../contacts/actions';
import { chooseFollowUp, findFollowUp, redraftFollowUp, saveFollowUpNote } from './actions';

const FIND = 'app/jobs/(app)/follow-ups/actions.ts#findFollowUp';
const CHOOSE = 'app/jobs/(app)/follow-ups/actions.ts#chooseFollowUp';
const REDRAFT = 'app/jobs/(app)/follow-ups/actions.ts#redraftFollowUp';

const CHANNEL_WORDS: Record<string, string> = {
  linkedin_dm: 'LinkedIn message',
  linkedin_connect: 'LinkedIn connection note',
  email: 'Email',
  intro: 'Introduction',
  event: 'In person',
  other: 'Message',
};

export type CompanyContact = { id: string; name: string; title: string | null };

/**
 * The person an application is followed up with and the note to them, on
 * the role page and in the Follow-ups list (lib/jobs/followup). The note is
 * a draft on the contact: edited here, copied out, and marked sent once it
 * goes, which logs the send on the contact as every draft does.
 */
export function FollowUpCard({
  initial,
  contacts = [],
  timezone,
  heading = 'Follow up with',
}: {
  initial: FollowUp;
  /** The person's contacts at the company, to choose one by hand. */
  contacts?: readonly CompanyContact[];
  timezone: string;
  /** The card's title: "Follow up with" on the role page, the role itself in the list. */
  heading?: React.ReactNode;
}) {
  const [followUp, setFollowUp] = useState(initial);
  const [text, setText] = useState(initial.draft?.message ?? '');
  const [error, setError] = useState<string | null>(null);
  // A contact chosen from the list, waiting on Write to them.
  const [picked, setPicked] = useState('');
  const [working, setWorking] = useState<'find' | 'replace' | 'choose' | 'redraft' | 'sent' | null>(null);
  const [, startTransition] = useTransition();

  const person = followUp.person;
  const draft = followUp.draft;
  const others = contacts.filter((c) => c.id !== person?.id);

  function run(kind: NonNullable<typeof working>, call: () => Promise<{ error: string | null; note?: string; followUp?: FollowUp }>) {
    setWorking(kind);
    setError(null);
    startTransition(async () => {
      try {
        const result = await call();
        if (result.followUp) {
          setFollowUp(result.followUp);
          setText(result.followUp.draft?.message ?? '');
        }
        setError(result.error ?? result.note ?? null);
      } catch {
        setError('That stopped before it finished. Try again.');
      } finally {
        setWorking(null);
      }
    });
  }

  function markSent() {
    if (!draft) return;
    setWorking('sent');
    setError(null);
    startTransition(async () => {
      const saved = text !== draft.message ? await saveFollowUpNote(draft.id, text) : { error: null };
      const result = saved.error ? saved : await markTouchSent(draft.id);
      setWorking(null);
      if (result.error) return setError(`Not marked sent: ${result.error}`);
      setFollowUp({
        ...followUp,
        draft: null,
        sent: { id: draft.id, channel: draft.channel, sentAt: new Date().toISOString(), respondedAt: null },
      });
    });
  }

  const busy = working !== null;
  const reach = person
    ? person.linkedinUrl ?? linkedinSearchUrl(`${person.name} ${followUp.company}`)
    : null;

  return (
    <CardSection title={heading} padding="standard">
      <div className="space-y-3">
        {person ? (
          <div className="space-y-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <Link href={`/jobs/contacts/${person.id}`} className="press-area text-ui font-medium text-ink">
                {person.name}
              </Link>
              {person.title && <span className="text-small text-ink-muted">{person.title}</span>}
            </div>
            {followUp.why && <p className="text-small text-ink-muted">{followUp.why}</p>}
            <div className="flex flex-wrap gap-x-3 text-small">
              {reach && (
                <a href={reach} target="_blank" rel="noreferrer" className={cn(linkVariants({ tone: 'quiet' }), 'press-area')}>
                  {person.linkedinUrl ? 'LinkedIn profile' : 'Find them on LinkedIn'}
                </a>
              )}
              {person.email && (
                <a href={`mailto:${person.email}`} className={cn(linkVariants({ tone: 'quiet' }), 'press-area')}>
                  {person.email}
                </a>
              )}
            </div>
          </div>
        ) : (
          <p className="text-ui text-ink-muted">
            {followUp.triedAt
              ? `Nobody named yet. Dash last looked on ${formatDate(followUp.triedAt, timezone)}.`
              : 'Nobody named yet.'}
          </p>
        )}

        {followUp.sent && (
          <p className="text-small text-ink-muted">
            {CHANNEL_WORDS[followUp.sent.channel] ?? 'Message'} sent {formatDate(followUp.sent.sentAt, timezone)}
            {followUp.sent.respondedAt ? ', and they answered.' : ', no reply yet.'}
          </p>
        )}

        {person && draft && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-small text-ink-muted">{CHANNEL_WORDS[draft.channel] ?? 'Message'}, not sent yet</span>
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
                  if (result.error) setError(`Your edit was not kept: ${result.error}`);
                  else setFollowUp((f) => (f.draft ? { ...f, draft: { ...f.draft, message: text } } : f));
                });
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={markSent} pending={working === 'sent'} disabled={busy}>
                Mark sent
              </Button>
              <DashAction
                size="sm"
                variant="secondary"
                paid={REDRAFT}
                pending={working === 'redraft'}
                disabled={busy}
                onClick={() => run('redraft', () => redraftFollowUp(followUp.applicationId))}
              >
                {working === 'redraft' ? 'Writing' : 'Write it again'}
              </DashAction>
            </div>
          </div>
        )}

        {person && !draft && !followUp.sent && (
          <DashAction
            size="sm"
            paid={REDRAFT}
            pending={working === 'redraft'}
            disabled={busy}
            onClick={() => run('redraft', () => redraftFollowUp(followUp.applicationId))}
          >
            {working === 'redraft' ? 'Writing' : 'Write the note'}
          </DashAction>
        )}

        {!person && (
          <DashAction
            size="sm"
            paid={FIND}
            pending={working === 'find'}
            disabled={busy}
            onClick={() => run('find', () => findFollowUp(followUp.applicationId))}
          >
            {working === 'find' ? 'Looking' : 'Find who to tell'}
          </DashAction>
        )}

        {(person || others.length > 0) && (
          <div className={cn('flex flex-wrap items-center gap-2', person && 'border-t border-border pt-3')}>
            {person && (
              <DashAction
                size="sm"
                variant="ghost"
                paid={FIND}
                pending={working === 'replace'}
                disabled={busy}
                onClick={() => run('replace', () => findFollowUp(followUp.applicationId, true))}
              >
                {working === 'replace' ? 'Looking' : 'Someone else'}
              </DashAction>
            )}
            {others.length > 0 && (
              <Select
                aria-label="Choose from your contacts"
                value={picked}
                disabled={busy}
                className="w-auto max-w-full"
                onChange={(event) => setPicked(event.target.value)}
              >
                <option value="">Choose from your contacts</option>
                {others.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title ? `${c.name}, ${c.title}` : c.name}
                  </option>
                ))}
              </Select>
            )}
            {picked && (
              <DashAction
                size="sm"
                variant="secondary"
                paid={CHOOSE}
                pending={working === 'choose'}
                disabled={busy}
                onClick={() =>
                  run('choose', async () => {
                    const result = await chooseFollowUp(followUp.applicationId, picked);
                    setPicked('');
                    return result;
                  })
                }
              >
                {working === 'choose' ? 'Writing' : 'Write to them'}
              </DashAction>
            )}
          </div>
        )}

        {error && <p className="text-small text-danger" role="alert">{error}</p>}
      </div>
    </CardSection>
  );
}
