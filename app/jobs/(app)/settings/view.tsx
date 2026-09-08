'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { Copy, Mail, ShieldAlert, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/field';
import { formatDate } from '@/lib/jobs/applications/load';
import { backfillResumable, scanButtonLabel } from '@/lib/core/inbox/resume';
import { SyncProgressBar, useInboxSync } from '@/components/jobs/inbox/sync-run';
import { disconnectInbox, updateProfile, type SettingsState } from './actions';
import {
  acceptEvidence,
  addEvidence,
  addResumeVersion,
  deleteEvidence,
  proposeEvidence,
} from './evidence-actions';
import { addExcludedSender, removeExcludedSender } from './sender-actions';
import { DEFAULT_BANNED_CONSTRUCTIONS } from '@/lib/jobs/evidence/draft-payload';
import { cardVariants } from '@/components/ui/card';

export function SettingsView(props: {
  email: string;
  banner: { tone: 'ok' | 'warn' | 'err'; text: string } | null;
  gmailConfigured: boolean;
  appOrigin: string;
  profile: {
    targetTitles: string;
    searchStartedOn: string;
    ghostThresholdDays: number;
    writingStyleNotes: string;
    bannedConstructions: string;
  };
  accounts: InboxAccount[];
  resumes: Array<{
    id: string;
    label: string;
    isDefault: boolean;
    notes: string | null;
    hasText: boolean;
  }>;
  excludedSenders: Array<{ id: string; domain: string }>;
  evidence: Array<{
    id: string;
    title: string;
    body: string;
    context: string | null;
    skills: string[];
    metrics: string | null;
    strength: number;
    usedCount: number;
  }>;
}) {
  return (
    <div className="space-y-6">
      {props.banner && (
        <p
          className={cn(
            'rounded-lg px-3 py-2 text-ui',
            props.banner.tone === 'ok' && 'bg-status-offer-tint text-status-offer',
            props.banner.tone === 'warn' && 'bg-caution-tint text-ink',
            props.banner.tone === 'err' && 'bg-status-rejected-tint text-status-rejected',
          )}
        >
          {props.banner.text}
        </p>
      )}

      <ProfileSection profile={props.profile} email={props.email} />
      <InboxSection
        accounts={props.accounts}
        gmailConfigured={props.gmailConfigured}
      />
      <BookmarkletSection appOrigin={props.appOrigin} />
      <ExcludedSendersSection excludedSenders={props.excludedSenders} />
      <ResumeSection resumes={props.resumes} />
      <EvidenceSection evidence={props.evidence} resumes={props.resumes} />
      <DangerSection />
    </div>
  );
}

function ProfileSection({
  profile,
  email,
}: {
  profile: {
    targetTitles: string;
    searchStartedOn: string;
    ghostThresholdDays: number;
    writingStyleNotes: string;
    bannedConstructions: string;
  };
  email: string;
}) {
  const [state, action] = useActionState<SettingsState, FormData>(updateProfile, {});

  return (
    <section className={cardVariants({ padding: 'standard' })}>
      <h2 className="text-body font-semibold text-ink">Job search</h2>
      <p className="mt-0.5 text-ui text-ink-muted">{email}</p>
      <p className="mt-2 text-small text-ink-muted">
        Your name and timezone are account settings now — they hold across every workspace, so
        they live under{' '}
        <a href="/account" className="font-medium text-accent underline underline-offset-2">
          Account
        </a>
        .
      </p>

      <form action={action} className="mt-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="searchStartedOn">Search started</Label>
            <Input
              id="searchStartedOn"
              name="searchStartedOn"
              type="date"
              defaultValue={profile.searchStartedOn}
            />
            <p className="mt-1 text-small text-ink-muted">Anchors every funnel time series.</p>
          </div>
          <div>
            <Label htmlFor="ghostThresholdDays">Ghost after</Label>
            <Input
              id="ghostThresholdDays"
              name="ghostThresholdDays"
              type="number"
              min={7}
              max={180}
              defaultValue={profile.ghostThresholdDays}
            />
            <p className="mt-1 text-micro leading-relaxed text-ink-muted">
              Days of silence before a live pursuit is treated as ghosted. Derived, never set by
              hand — the moment it becomes manual, nobody maintains it and the funnel counts
              abandoned pursuits as live ones.
            </p>
          </div>
        </div>

        <div>
          <Label htmlFor="targetTitles">Target titles</Label>
          <Input
            id="targetTitles"
            name="targetTitles"
            defaultValue={profile.targetTitles}
            placeholder="Strategic Finance Analyst, FP&A Manager"
          />
          <p className="mt-1 text-small text-ink-muted">
            Seeds relevance scoring when mail is classified.
          </p>
        </div>

        <div>
          <Label htmlFor="writingStyleNotes">How you want to sound</Label>
          <Textarea
            id="writingStyleNotes"
            name="writingStyleNotes"
            rows={3}
            defaultValue={profile.writingStyleNotes}
            placeholder="Direct. Specific numbers. No throat-clearing. British spelling."
          />
          <p className="mt-1 text-small text-ink-muted">
            Injected into every generated draft. Revise it whenever one comes back
            wrong.
          </p>
        </div>

        <div>
          <Label htmlFor="bannedConstructions">Never write these</Label>
          <Textarea
            id="bannedConstructions"
            name="bannedConstructions"
            rows={4}
            defaultValue={profile.bannedConstructions}
            placeholder={DEFAULT_BANNED_CONSTRUCTIONS.join('\n')}
          />
          <p className="mt-1 text-micro leading-relaxed text-ink-muted">
            One per line. Checked deterministically after generation rather than only asked for in
            the prompt — a prompt instruction is not reliable enough for something you would
            notice in every single draft. Leave it empty and the list shown here is used.
          </p>
        </div>

        {state.error && (
          <p role="alert" className="text-ui text-status-rejected">
            {state.error}
          </p>
        )}
        {state.message && <p className="text-ui text-status-offer">{state.message}</p>}

        <Button type="submit" size="sm">
          Save
        </Button>
      </form>
    </section>
  );
}

export type InboxAccount = {
  id: string;
  emailAddress: string;
  status: string;
  lastSyncedAt: string | null;
  backfillCompletedAt: string | null;
  backfillWindowDays: number;
  /** The last first-scan attempt, so a stopped one can say so. */
  latestBackfill: {
    status: string;
    messagesSeen: number;
    error: string | null;
    finishedAt: string | null;
  } | null;
};

function backfillStateOf(account: InboxAccount) {
  return {
    accountStatus: account.status,
    backfillCompletedAt: account.backfillCompletedAt,
    latestJob: account.latestBackfill
      ? { status: account.latestBackfill.status, messagesSeen: account.latestBackfill.messagesSeen }
      : null,
  };
}

function InboxSection({
  accounts,
  gmailConfigured,
}: {
  accounts: InboxAccount[];
  gmailConfigured: boolean;
}) {
  const { busy, note, setNote, jobs, startSync } = useInboxSync();
  const [, startTransition] = useTransition();

  return (
    <section id="inboxes" className={cardVariants({ padding: 'standard' })}>
      <h2 className="text-body font-semibold text-ink">Connected inboxes</h2>
      <p className="mt-0.5 text-ui leading-relaxed text-ink-muted">
        Read-only, scoped to a search query about recruiting mail. Message bodies are never
        stored. Subjects and senders are kept only for the messages that turn out to be relevant —
        everything else keeps nothing but an id and a date so the next scan can skip it.
      </p>

      {accounts.length === 0 ? (
        <div className="mt-4">
          {gmailConfigured ? (
            <a href="/api/auth/gmail/connect?return_to=/jobs/settings" className="inline-block">
              <Button type="button" size="sm">
                <Mail className="size-4" strokeWidth={1.75} />
                Connect Gmail
              </Button>
            </a>
          ) : (
            <p className="rounded-lg bg-canvas px-3 py-2 text-ui text-ink-muted">
              Inbox scanning for the job search side is not connected yet — it needs its own
              Google grant, separate from the one the shopping side uses. Everything else works
              without it: add roles by pasting a job link, or use the capture bookmarklet.
            </p>
          )}
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {accounts.map((account) => (
            <li key={account.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-ui font-medium text-ink">{account.emailAddress}</span>
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-micro',
                    account.status === 'active'
                      ? 'bg-status-offer-tint text-status-offer'
                      : 'bg-caution-tint text-ink',
                  )}
                >
                  {account.status.replace(/_/g, ' ')}
                </span>
                <span className="tabular ml-auto text-small text-ink-muted">
                  last checked {formatDate(account.lastSyncedAt)}
                </span>
              </div>

              {account.status === 'needs_reauth' && (
                <p className="mt-2 rounded bg-caution-tint px-2 py-1.5 text-small text-ink">
                  Google stopped honouring the token. Reconnect below. If this happens weekly, the
                  OAuth app is still in Testing status — Google expires refresh tokens every seven
                  days there.
                </p>
              )}

              {backfillResumable(backfillStateOf(account)) && account.latestBackfill && (
                // The scan hands off between server invocations and the host
                // cuts that chain after a few hops, so a long first scan stops
                // partway. It resumes where it stopped -- which the page has to
                // actually say, or the only reading left is that nothing
                // happened the last six times.
                <p className="mt-2 rounded bg-canvas px-2 py-1.5 text-small text-ink-muted">
                  First scan stopped partway — {account.latestBackfill.messagesSeen} messages read
                  {account.latestBackfill.finishedAt
                    ? `, ${formatDate(account.latestBackfill.finishedAt)}`
                    : ''}
                  . It picks up where it left off, and keeps going on its own while a page of the
                  app is open.
                </p>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {/*
                  Check now is the primary action once the first scan is done.
                  The automatic check runs once a day, so this is the button you
                  actually reach for when you are expecting something.
                */}
                {account.backfillCompletedAt && (
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy === account.id}
                    onClick={() => startSync(account.id, 'incremental')}
                  >
                    Check now
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant={account.backfillCompletedAt ? 'ghost' : 'primary'}
                  disabled={busy === account.id}
                  onClick={() => startSync(account.id, 'backfill')}
                >
                  {scanButtonLabel(backfillStateOf(account))}
                </Button>
                <a
                  href="/api/auth/gmail/connect?return_to=/jobs/settings"
                  className="text-small text-ink-muted underline underline-offset-2 hover:text-ink"
                >
                  Reconnect
                </a>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    startTransition(async () => {
                      const result = await disconnectInbox(account.id);
                      setNote(result.error ?? 'Disconnected, and the Google grant was revoked.');
                    })
                  }
                >
                  Disconnect
                </Button>
              </div>

              {jobs[account.id] && (
                <SyncProgressBar accountId={account.id} job={jobs[account.id]} />
              )}
            </li>
          ))}
        </ul>
      )}

      {note && <p className="mt-3 text-ui text-ink-muted">{note}</p>}

      <p className="mt-3 text-ui leading-relaxed text-ink-muted">
        Your inbox is checked automatically <strong className="font-medium">once a day</strong>.
        Use <strong className="font-medium">Check now</strong> when you are expecting something —
        an interview invite is the one kind of mail where a day of delay actually costs you.
        Running it more often is free and never duplicates anything.
      </p>

      <p className="mt-2 text-micro leading-relaxed text-ink-muted">
        Coverage is partial by design. Recruiters emailing from a company address with a subject
        like &ldquo;quick question&rdquo; match no keyword, so a second pass searches the domains
        of the companies you track. Add domains on a company page when its mail is not linking, and
        forward anything the scan misses.
      </p>
    </section>
  );
}

function BookmarkletSection({ appOrigin }: { appOrigin: string }) {
  const [href, setHref] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Built in the browser so the origin is the one actually being used.
    const origin = window.location.origin || appOrigin;
    fetch('/bookmarklet.js')
      .then((response) => response.text())
      .then((source) => {
        setHref(
          `javascript:${encodeURIComponent(source.replace('__APP_ORIGIN__', origin))}`,
        );
      })
      .catch(() => setHref(''));
  }, [appOrigin]);

  return (
    <section id="bookmarklet" className={cardVariants({ padding: 'standard' })}>
      <h2 className="text-body font-semibold text-ink">Capture application questions</h2>
      <p className="mt-0.5 text-ui leading-relaxed text-ink-muted">
        Drag this to your bookmarks bar. On an application form, click it: it reads the question
        labels and sends them here. It runs in your browser inside your session, which is why it
        works on Workday and iCIMS where nothing server-side can. It never reads what you have
        typed and never submits anything.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {href ? (
          <a
            href={href}
            onClick={(event) => event.preventDefault()}
            className="press cursor-grab rounded-lg border border-border bg-canvas px-3 py-1.5 text-ui font-medium text-accent"
            title="Drag me to your bookmarks bar"
          >
            Capture questions
          </a>
        ) : (
          <span className="skeleton inline-block h-8 w-40" />
        )}
        {href && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard.writeText(href);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            }}
          >
            <Copy className="size-3.5" strokeWidth={1.75} />
            {copied ? 'Copied' : 'Copy the link'}
          </Button>
        )}
      </div>

      <p className="mt-3 text-micro leading-relaxed text-ink-muted">
        Only Greenhouse publishes its application questions to an API, so for every other vendor
        this is the way in. The paste box on any role always works too.
      </p>
    </section>
  );
}

function ExcludedSendersSection({
  excludedSenders,
}: {
  excludedSenders: Array<{ id: string; domain: string }>;
}) {
  const [state, action] = useActionState(addExcludedSender, {});
  const [, startTransition] = useTransition();

  return (
    <section className={cardVariants({ padding: 'standard' })}>
      <h2 className="text-body font-semibold text-ink">Excluded senders</h2>
      <p className="mt-0.5 text-ui leading-relaxed text-ink-muted">
        Mail from Indeed is already excluded everywhere for everyone — it is suggested jobs, not
        anything you applied to. Add a domain here for anything else that keeps showing up as a
        lead it should not be, like a job board or a newsletter.
      </p>

      {excludedSenders.length > 0 && (
        <ul className="mt-3 space-y-1">
          {excludedSenders.map((entry) => (
            <li key={entry.id} className="flex items-center gap-2 text-ui">
              <span className="tabular text-ink">{entry.domain}</span>
              <button
                type="button"
                className="ml-auto text-ink-muted hover:text-status-rejected"
                onClick={() =>
                  startTransition(async () => {
                    await removeExcludedSender(entry.id);
                  })
                }
                aria-label={`Stop excluding ${entry.domain}`}
              >
                <Trash2 className="size-3.5" strokeWidth={1.75} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <Label htmlFor="domain">Domain</Label>
          <Input id="domain" name="domain" placeholder="jobs.example.com" />
        </div>
        <Button type="submit" size="sm" variant="secondary">
          Exclude
        </Button>
      </form>
      {state.error && <p className="mt-2 text-ui text-status-rejected">{state.error}</p>}
      {state.message && <p className="mt-2 text-ui text-status-offer">{state.message}</p>}
    </section>
  );
}

function ResumeSection({
  resumes,
}: {
  resumes: Array<{ id: string; label: string; notes: string | null; isDefault: boolean; hasText: boolean }>;
}) {
  const [state, action] = useActionState(addResumeVersion, {});

  return (
    <section className={cardVariants({ padding: 'standard' })}>
      <h2 className="text-body font-semibold text-ink">Resume versions</h2>
      <p className="mt-0.5 text-ui text-ink-muted">
        Point applications at a version, and you find out which one correlates with getting past
        resume review.
      </p>

      {resumes.length > 0 && (
        <ul className="mt-3 space-y-1">
          {resumes.map((resume) => (
            <li key={resume.id} className="flex items-baseline gap-2 text-ui">
              <span className="font-medium text-ink">{resume.label}</span>
              {resume.isDefault && <span className="text-micro text-accent">default</span>}
              {!resume.hasText && (
                <span className="text-small text-ink-muted">no text pasted</span>
              )}
              {resume.notes && <span className="text-ink-muted">{resume.notes}</span>}
            </li>
          ))}
        </ul>
      )}

      <form action={action} className="mt-3 space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-32">
            <Label htmlFor="label">Label</Label>
            <Input id="label" name="label" required placeholder="C" />
          </div>
          <div className="min-w-48 flex-1">
            <Label htmlFor="notes">What is different about it</Label>
            <Input id="notes" name="notes" placeholder="Fintech-leaning, metrics up top" />
          </div>
          <Button type="submit" size="sm" variant="secondary">
            Add
          </Button>
        </div>
        <div>
          <Label htmlFor="textContent">Paste the text</Label>
          <Textarea
            id="textContent"
            name="textContent"
            rows={4}
            placeholder="Paste the whole resume. Formatting does not matter."
          />
          <p className="mt-1 text-small text-ink-muted">
            Optional, but it is what the evidence bank reads to propose your stories.
          </p>
        </div>
      </form>
      {state.error && <p className="mt-2 text-ui text-status-rejected">{state.error}</p>}
      {state.message && <p className="mt-2 text-ui text-status-offer">{state.message}</p>}
    </section>
  );
}

function EvidenceSection({
  evidence,
  resumes,
}: {
  resumes: Array<{ id: string; label: string; hasText: boolean }>;
  evidence: Array<{
    id: string;
    title: string;
    body: string;
    context: string | null;
    skills: string[];
    metrics: string | null;
    strength: number;
    usedCount: number;
  }>;
}) {
  const [state, action] = useActionState(addEvidence, {});
  const [, startTransition] = useTransition();

  return (
    <section className={cardVariants({ padding: 'standard' })}>
      <h2 className="text-body font-semibold text-ink">Evidence bank</h2>
      <p className="mt-0.5 text-ui leading-relaxed text-ink-muted">
        Your actual experience, in your own words. Twenty to thirty entries is the target. The
        quality ceiling of every draft this app will ever write is set here — no amount of prompt
        engineering compensates for an empty bank, which is why the editor exists before the
        writing does.
      </p>

      <p className="tabular mt-2 text-ui text-ink">
        {evidence.length} stored
        {evidence.length < 20 && (
          <span className="ml-2 text-caution">
            {20 - evidence.length} short of a useful bank
          </span>
        )}
      </p>

      {evidence.length > 0 && (
        <ul className="mt-3 space-y-2">
          {evidence.map((item) => (
            <li key={item.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-ui font-medium text-ink">{item.title}</span>
                <span className="tabular text-small text-ink-muted">
                  {'★'.repeat(item.strength)}
                </span>
                {item.skills.map((skill) => (
                  <span
                    key={skill}
                    className="rounded-full bg-canvas px-1.5 py-0.5 text-small text-ink-muted"
                  >
                    {skill.replace(/_/g, ' ')}
                  </span>
                ))}
                <button
                  type="button"
                  className="ml-auto text-ink-muted hover:text-status-rejected"
                  onClick={() =>
                    startTransition(async () => {
                      await deleteEvidence(item.id);
                    })
                  }
                  aria-label={`Delete ${item.title}`}
                >
                  <Trash2 className="size-3.5" strokeWidth={1.75} />
                </button>
              </div>
              <p className="mt-1 line-clamp-3 text-small text-ink-muted">{item.body}</p>
              {item.metrics && (
                <p className="tabular mt-1 text-small text-ink">{item.metrics}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      <SeedFromWriting resumes={resumes} />

      <form action={action} className="mt-4 space-y-3 border-t border-border pt-4">
        <div>
          <Label htmlFor="title">Short handle</Label>
          <Input id="title" name="title" required placeholder="Rebuilt the close process" />
        </div>
        <div>
          <Label htmlFor="body">The story</Label>
          <Textarea
            id="body"
            name="body"
            rows={4}
            required
            placeholder="What the situation was, what you did, what happened. Your words, not a template."
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="context">Where and when</Label>
            <Input id="context" name="context" placeholder="Acme, 2024" />
          </div>
          <div>
            <Label htmlFor="metrics">The number</Label>
            <Input id="metrics" name="metrics" placeholder="Close went from 9 days to 4" />
          </div>
          <div>
            <Label htmlFor="strength">How strong is it</Label>
            <Select id="strength" name="strength" defaultValue="3">
              {[5, 4, 3, 2, 1].map((level) => (
                <option key={level} value={level}>
                  {'★'.repeat(level)}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="skills">Tags</Label>
          <Input
            id="skills"
            name="skills"
            placeholder="financial modeling, stakeholder management, automation"
          />
        </div>

        {state.error && <p className="text-ui text-status-rejected">{state.error}</p>}
        {state.message && <p className="text-ui text-status-offer">{state.message}</p>}

        <Button type="submit" size="sm">
          Add to the bank
        </Button>
      </form>
    </section>
  );
}

/**
 * Seeding the bank from writing that already exists in the account.
 *
 * The one-at-a-time form below is why the bank is empty: nobody fills in six
 * fields twenty times. A resume, the answers you have approved and the
 * debriefs you wrote are all stories in your own words already, so the model
 * only has to split them up. It proposes; you tick and edit. Nothing lands
 * unread, because a bad item in the bank is invisible after the fact and
 * degrades every match built on top of it.
 */
type EvidenceDraft = {
  title: string;
  body: string;
  context: string | null;
  metrics: string | null;
  strength: number;
  /** Kept as typed text, so a half-finished tag is not lost on every keystroke. */
  skillsText: string;
  picked: boolean;
};

function SeedFromWriting({ resumes }: { resumes: Array<{ id: string; label: string; hasText: boolean }> }) {
  const readable = resumes.filter((resume) => resume.hasText);

  const [, startTransition] = useTransition();

  const [kind, setKind] = useState<'resume' | 'answers' | 'debriefs'>('resume');
  const [resumeVersionId, setResumeVersionId] = useState(readable[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<EvidenceDraft[] | null>(null);

  const sources: Array<{ value: typeof kind; label: string }> = [
    { value: 'resume', label: 'A resume' },
    { value: 'answers', label: 'Approved answers' },
    { value: 'debriefs', label: 'Interview debriefs' },
  ];

  function patch(index: number, changes: Partial<EvidenceDraft>) {
    setDrafts((current) =>
      (current ?? []).map((draft, i) => (i === index ? { ...draft, ...changes } : draft)),
    );
  }

  const picked = (drafts ?? []).filter((draft) => draft.picked);

  return (
    <div className="mt-4 rounded-lg border border-border bg-canvas p-3">
      <h3 className="text-ui font-medium text-ink">Seed it from what you have written</h3>
      <p className="mt-0.5 text-small leading-relaxed text-ink-muted">
        Read a resume, your approved behavioural answers, or your interview debriefs, and propose
        the stories in them. Nothing is added until you tick it.
      </p>

      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor="seed-kind">Read</Label>
          <Select
            id="seed-kind"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as typeof kind);
              setDrafts(null);
              setError(null);
              setMessage(null);
            }}
          >
            {sources.map((source) => (
              <option key={source.value} value={source.value}>
                {source.label}
              </option>
            ))}
          </Select>
        </div>

        {kind === 'resume' && (
          <div>
            <Label htmlFor="seed-resume">Version</Label>
            <Select
              id="seed-resume"
              value={resumeVersionId}
              disabled={readable.length === 0}
              onChange={(event) => setResumeVersionId(event.target.value)}
            >
              {readable.length === 0 ? (
                <option value="">No version has text pasted</option>
              ) : (
                readable.map((resume) => (
                  <option key={resume.id} value={resume.id}>
                    {resume.label}
                  </option>
                ))
              )}
            </Select>
          </div>
        )}

        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy || (kind === 'resume' && !resumeVersionId)}
          onClick={() => {
            setBusy(true);
            setError(null);
            setMessage(null);
            setDrafts(null);
            startTransition(async () => {
              const result = await proposeEvidence({
                kind,
                resumeVersionId: kind === 'resume' ? resumeVersionId : undefined,
              });
              setBusy(false);
              if (result.error || !result.proposal) {
                setError(result.error ?? 'Nothing came back.');
                return;
              }
              setDrafts(
                result.proposal.candidates.map((candidate) => ({
                  ...candidate,
                  picked: true,
                  skillsText: candidate.skills.join(', '),
                })),
              );
            });
          }}
        >
          {busy ? 'Reading…' : 'Propose'}
        </Button>

        {error && <span className="text-small text-status-rejected">{error}</span>}
        {message && <span className="text-small text-status-offer">{message}</span>}
      </div>

      {drafts && drafts.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          <p className="text-small text-ink-muted">
            {drafts.length} proposed. Edit anything that is not how you would put it — this is the
            text every future draft quotes.
          </p>

          {drafts.map((draft, index) => (
            <div
              key={index}
              className={cn(
                'rounded-lg border p-2',
                draft.picked ? 'border-border-strong bg-surface' : 'border-border opacity-60',
              )}
            >
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-2"
                  checked={draft.picked}
                  onChange={(event) => patch(index, { picked: event.target.checked })}
                  aria-label={`Add ${draft.title}`}
                />
                <div className="min-w-0 flex-1 space-y-2">
                  <Input
                    value={draft.title}
                    aria-label="Short handle"
                    onChange={(event) => patch(index, { title: event.target.value })}
                  />
                  <Textarea
                    rows={3}
                    value={draft.body}
                    aria-label="The story"
                    onChange={(event) => patch(index, { body: event.target.value })}
                  />
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Input
                      value={draft.context ?? ''}
                      placeholder="Where and when"
                      aria-label="Where and when"
                      onChange={(event) => patch(index, { context: event.target.value })}
                    />
                    <Input
                      value={draft.metrics ?? ''}
                      placeholder="The number"
                      aria-label="The number"
                      onChange={(event) => patch(index, { metrics: event.target.value })}
                    />
                    <Select
                      value={String(draft.strength)}
                      aria-label="How strong is it"
                      onChange={(event) => patch(index, { strength: Number(event.target.value) })}
                    >
                      {[5, 4, 3, 2, 1].map((level) => (
                        <option key={level} value={level}>
                          {'★'.repeat(level)}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Input
                    value={draft.skillsText}
                    placeholder="Tags"
                    aria-label="Tags"
                    onChange={(event) => patch(index, { skillsText: event.target.value })}
                  />
                </div>
              </div>
            </div>
          ))}

          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy || picked.length === 0}
              onClick={() => {
                setBusy(true);
                setError(null);
                startTransition(async () => {
                  const result = await acceptEvidence({
                    items: picked.map((draft) => ({
                      title: draft.title.trim(),
                      body: draft.body.trim(),
                      context: draft.context?.trim() || null,
                      metrics: draft.metrics?.trim() || null,
                      strength: draft.strength,
                      skills: draft.skillsText
                        .split(/[,\n]/)
                        .map((entry) => entry.trim())
                        .filter(Boolean),
                    })),
                  });
                  setBusy(false);
                  if (result.error) {
                    setError(result.error);
                    return;
                  }
                  setDrafts(null);
                  setMessage(`Added ${result.added} to the bank.`);
                });
              }}
            >
              Add {picked.length} to the bank
            </Button>
            <button
              type="button"
              className="text-small text-ink-muted hover:text-ink"
              onClick={() => {
                setDrafts(null);
                setMessage(null);
              }}
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DangerSection() {
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <section className="rounded-card border border-status-rejected/30 bg-surface p-5">
      <h2 className="flex items-center gap-2 text-body font-semibold text-status-rejected">
        <ShieldAlert className="size-4" strokeWidth={1.75} />
        Delete everything
      </h2>
      <p className="mt-1 text-ui leading-relaxed text-ink-muted">
        Revokes the Google grant, deletes every row and every stored file, and removes the account
        itself. There is no undo and no export first.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <Label htmlFor="confirm">Type &ldquo;delete everything&rdquo;</Label>
          <Input
            id="confirm"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            placeholder="delete everything"
          />
        </div>
        <Button
          type="button"
          variant="danger"
          size="sm"
          disabled={busy || confirm.trim().toLowerCase() !== 'delete everything'}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const response = await fetch('/api/account/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirm }),
              });
              if (response.ok) {
                window.location.href = '/';
                return;
              }
              const data = await response.json();
              setError(data.error ?? 'Could not delete the account.');
            } catch {
              setError('Could not delete the account.');
            } finally {
              setBusy(false);
            }
          }}
        >
          Delete
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-ui text-status-rejected">
          {error}
        </p>
      )}
    </section>
  );
}
