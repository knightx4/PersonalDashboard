'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { Copy, Mail, ShieldAlert, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/field';
import { formatDate } from '@/lib/jobs/applications/load';
import { disconnectInbox, updateProfile, type SettingsState } from './actions';
import { addEvidence, addResumeVersion, deleteEvidence } from './evidence-actions';

export function SettingsView(props: {
  email: string;
  banner: { tone: 'ok' | 'warn' | 'err'; text: string } | null;
  gmailConfigured: boolean;
  appOrigin: string;
  profile: {
    displayName: string;
    timezone: string;
    targetTitles: string;
    searchStartedOn: string;
    ghostThresholdDays: number;
    writingStyleNotes: string;
    bannedConstructions: string;
  };
  accounts: Array<{
    id: string;
    emailAddress: string;
    status: string;
    lastSyncedAt: string | null;
    backfillCompletedAt: string | null;
    backfillWindowDays: number;
  }>;
  resumes: Array<{ id: string; label: string; isDefault: boolean; notes: string | null }>;
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
            'rounded-lg px-3 py-2 text-[13px]',
            props.banner.tone === 'ok' && 'bg-status-offer-tint text-status-offer',
            props.banner.tone === 'warn' && 'bg-accent-orange-tint text-ink',
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
      <ResumeSection resumes={props.resumes} />
      <EvidenceSection evidence={props.evidence} />
      <DangerSection />
    </div>
  );
}

function ProfileSection({
  profile,
  email,
}: {
  profile: {
    displayName: string;
    timezone: string;
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
    <section className="rounded-card border border-border bg-surface p-5">
      <h2 className="text-sm font-semibold text-ink">Profile</h2>
      <p className="mt-0.5 text-[13px] text-ink-muted">{email}</p>

      <form action={action} className="mt-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="displayName">Name</Label>
            <Input id="displayName" name="displayName" defaultValue={profile.displayName} />
          </div>
          <div>
            <Label htmlFor="timezone">Timezone</Label>
            <Input
              id="timezone"
              name="timezone"
              defaultValue={profile.timezone}
              placeholder="Europe/London"
              list="timezone-options"
            />
            {/*
              The list is the fix for how this broke: the field is free text,
              and "ET" is what a person types. It is still accepted — the action
              translates it — but offering the real names means most people
              never type an abbreviation in the first place.
            */}
            <datalist id="timezone-options">
              {timeZoneOptions().map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
            <p className="mt-1 text-[11px] text-ink-faint">
              Interview times and &ldquo;this week&rdquo; are read in this zone. A name like
              Europe/London or America/New_York — &ldquo;ET&rdquo; and friends are translated.
            </p>
          </div>
          <div>
            <Label htmlFor="searchStartedOn">Search started</Label>
            <Input
              id="searchStartedOn"
              name="searchStartedOn"
              type="date"
              defaultValue={profile.searchStartedOn}
            />
            <p className="mt-1 text-[11px] text-ink-faint">Anchors every funnel time series.</p>
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
            <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
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
          <p className="mt-1 text-[11px] text-ink-faint">
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
          <p className="mt-1 text-[11px] text-ink-faint">
            Injected into every generated draft in Phase 2. Revise it whenever one comes back
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
          />
          <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
            One per line. Checked deterministically after generation rather than only asked for in
            the prompt — a prompt instruction is not reliable enough for something you would
            notice in every single draft.
          </p>
        </div>

        {state.error && (
          <p role="alert" className="text-[13px] text-status-rejected">
            {state.error}
          </p>
        )}
        {state.message && <p className="text-[13px] text-status-offer">{state.message}</p>}

        <Button type="submit" size="sm">
          Save
        </Button>
      </form>
    </section>
  );
}

function InboxSection({
  accounts,
  gmailConfigured,
}: {
  accounts: Array<{
    id: string;
    emailAddress: string;
    status: string;
    lastSyncedAt: string | null;
    backfillCompletedAt: string | null;
    backfillWindowDays: number;
  }>;
  gmailConfigured: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function startSync(accountId: string, mode: 'backfill' | 'incremental') {
    setBusy(accountId);
    setNote(null);
    try {
      const response = await fetch('/api/inbox/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, mode }),
      });
      const data = await response.json();
      setNote(response.ok ? 'Started. Progress appears in the banner at the top.' : data.error);
    } catch {
      setNote('Could not start the scan.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section id="inboxes" className="rounded-card border border-border bg-surface p-5">
      <h2 className="text-sm font-semibold text-ink">Connected inboxes</h2>
      <p className="mt-0.5 text-[13px] leading-relaxed text-ink-muted">
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
            <p className="rounded-lg bg-canvas px-3 py-2 text-[13px] text-ink-muted">
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
                <span className="text-[13px] font-medium text-ink">{account.emailAddress}</span>
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[11px]',
                    account.status === 'active'
                      ? 'bg-status-offer-tint text-status-offer'
                      : 'bg-accent-orange-tint text-ink',
                  )}
                >
                  {account.status.replace(/_/g, ' ')}
                </span>
                <span className="tabular ml-auto text-[11px] text-ink-faint">
                  last checked {formatDate(account.lastSyncedAt)}
                </span>
              </div>

              {account.status === 'needs_reauth' && (
                <p className="mt-2 rounded bg-accent-orange-tint px-2 py-1.5 text-[12px] text-ink">
                  Google stopped honouring the token. Reconnect below. If this happens weekly, the
                  OAuth app is still in Testing status — Google expires refresh tokens every seven
                  days there.
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
                  {account.backfillCompletedAt ? 'Re-scan everything' : 'Start the first scan'}
                </Button>
                <a
                  href="/api/auth/gmail/connect?return_to=/jobs/settings"
                  className="text-[12px] text-ink-muted underline underline-offset-2 hover:text-ink"
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
            </li>
          ))}
        </ul>
      )}

      {note && <p className="mt-3 text-[13px] text-ink-muted">{note}</p>}

      <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">
        Your inbox is checked automatically <strong className="font-medium">once a day</strong>.
        Use <strong className="font-medium">Check now</strong> when you are expecting something —
        an interview invite is the one kind of mail where a day of delay actually costs you.
        Running it more often is free and never duplicates anything.
      </p>

      <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
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
    <section id="bookmarklet" className="rounded-card border border-border bg-surface p-5">
      <h2 className="text-sm font-semibold text-ink">Capture application questions</h2>
      <p className="mt-0.5 text-[13px] leading-relaxed text-ink-muted">
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
            className="press cursor-grab rounded-lg border border-border bg-canvas px-3 py-1.5 text-[13px] font-medium text-brand"
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

      <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
        Only Greenhouse publishes its application questions to an API, so for every other vendor
        this is the way in. The paste box on any role always works too.
      </p>
    </section>
  );
}

function ResumeSection({
  resumes,
}: {
  resumes: Array<{ id: string; label: string; isDefault: boolean; notes: string | null }>;
}) {
  const [state, action] = useActionState(addResumeVersion, {});

  return (
    <section className="rounded-card border border-border bg-surface p-5">
      <h2 className="text-sm font-semibold text-ink">Resume versions</h2>
      <p className="mt-0.5 text-[13px] text-ink-muted">
        Point applications at a version, and you find out which one correlates with getting past
        resume review.
      </p>

      {resumes.length > 0 && (
        <ul className="mt-3 space-y-1">
          {resumes.map((resume) => (
            <li key={resume.id} className="flex items-baseline gap-2 text-[13px]">
              <span className="font-medium text-ink">{resume.label}</span>
              {resume.isDefault && <span className="text-[11px] text-brand">default</span>}
              {resume.notes && <span className="text-ink-muted">{resume.notes}</span>}
            </li>
          ))}
        </ul>
      )}

      <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
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
      </form>
      {state.error && <p className="mt-2 text-[13px] text-status-rejected">{state.error}</p>}
      {state.message && <p className="mt-2 text-[13px] text-status-offer">{state.message}</p>}
    </section>
  );
}

function EvidenceSection({
  evidence,
}: {
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
    <section className="rounded-card border border-border bg-surface p-5">
      <h2 className="text-sm font-semibold text-ink">Evidence bank</h2>
      <p className="mt-0.5 text-[13px] leading-relaxed text-ink-muted">
        Your actual experience, in your own words. Twenty to thirty entries is the target. The
        quality ceiling of every draft this app will ever write is set here — no amount of prompt
        engineering compensates for an empty bank, which is why the editor exists before the
        writing does.
      </p>

      <p className="tabular mt-2 text-[13px] text-ink">
        {evidence.length} stored
        {evidence.length < 20 && (
          <span className="ml-2 text-accent-orange">
            {20 - evidence.length} short of a useful bank
          </span>
        )}
      </p>

      {evidence.length > 0 && (
        <ul className="mt-3 space-y-2">
          {evidence.map((item) => (
            <li key={item.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[13px] font-medium text-ink">{item.title}</span>
                <span className="tabular text-[11px] text-ink-faint">
                  {'★'.repeat(item.strength)}
                </span>
                {item.skills.map((skill) => (
                  <span
                    key={skill}
                    className="rounded-full bg-canvas px-1.5 py-0.5 text-[11px] text-ink-muted"
                  >
                    {skill.replace(/_/g, ' ')}
                  </span>
                ))}
                <button
                  type="button"
                  className="ml-auto text-ink-faint hover:text-status-rejected"
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
              <p className="mt-1 line-clamp-3 text-[12px] text-ink-muted">{item.body}</p>
              {item.metrics && (
                <p className="tabular mt-1 text-[12px] text-ink">{item.metrics}</p>
              )}
            </li>
          ))}
        </ul>
      )}

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

        {state.error && <p className="text-[13px] text-status-rejected">{state.error}</p>}
        {state.message && <p className="text-[13px] text-status-offer">{state.message}</p>}

        <Button type="submit" size="sm">
          Add to the bank
        </Button>
      </form>
    </section>
  );
}

function DangerSection() {
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <section className="rounded-card border border-status-rejected/30 bg-surface p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-status-rejected">
        <ShieldAlert className="size-4" strokeWidth={1.75} />
        Delete everything
      </h2>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
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
        <p role="alert" className="mt-2 text-[13px] text-status-rejected">
          {error}
        </p>
      )}
    </section>
  );
}

/** Every zone this browser knows, for the settings datalist. */
function timeZoneOptions(): string[] {
  try {
    const supported = (
      Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf;
    return supported ? supported('timeZone') : [];
  } catch {
    return [];
  }
}
