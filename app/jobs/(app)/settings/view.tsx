'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { Check, Copy, Mail, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, buttonVariants } from '@/components/ui/button';
import { Banner } from '@/components/ui/banner';
import { InlineInput, Input, Label } from '@/components/ui/field';
import { AddTrigger } from '@/components/ui/add-trigger';
import { ValueList, ValueRow } from '@/components/ui/value-row';
import { formatDate } from '@/lib/jobs/applications/load';
import { backfillResumable, scanButtonLabel } from '@/lib/core/inbox/resume';
import { SyncProgressBar, useInboxSync } from '@/components/jobs/inbox/sync-run';
import { disconnectInbox, savePreference, updateProfile, type SettingsState } from './actions';
import { addExcludedSender, removeExcludedSender } from './sender-actions';
import { cardVariants } from '@/components/ui/card';
import { useCloseOnSuccess } from '@/lib/jobs/use-close-on-success';
import {
  COMPANY_STAGE_LABELS,
  COMPANY_STAGES,
  formatPay,
  WORKPLACE_PREFERENCE_LABELS,
  WORKPLACE_PREFERENCES,
  type JobPreferences,
} from '@/lib/jobs/suggest/preferences';

/** The page's own three tones, in the four the Banner primitive names. */
const BANNER_TONE = { ok: 'info', warn: 'warn', err: 'bad' } as const;

export function SettingsView(props: {
  email: string;
  banner: { tone: 'ok' | 'warn' | 'err'; text: string } | null;
  gmailConfigured: boolean;
  appOrigin: string;
  profile: {
    searchStartedOn: string;
    ghostThresholdDays: number;
    preferences: JobPreferences;
  };
  accounts: InboxAccount[];
  excludedSenders: Array<{ id: string; domain: string }>;
}) {
  return (
    <div className="space-y-6">
      {/* The shared Banner, which this was a fourth hand-rolled copy of.
       *
       * `ok` maps to `info` rather than to `good`: the good tone means money
       * came back and nothing else, and "Gmail connected" was wearing it
       * because green is what a success message reaches for. It is also the
       * offer hue, which law 4 reserves for one stage of the pipeline and
       * nowhere else -- so the same class was breaking the same law twice. */}
      {props.banner && <Banner tone={BANNER_TONE[props.banner.tone]}>{props.banner.text}</Banner>}

      <ProfileSection profile={props.profile} email={props.email} />
      <InboxSection accounts={props.accounts} gmailConfigured={props.gmailConfigured} />
      <BookmarkletSection appOrigin={props.appOrigin} />
      <ExcludedSendersSection excludedSenders={props.excludedSenders} />
    </div>
  );
}

function ProfileSection({
  profile,
  email,
}: {
  profile: {
    searchStartedOn: string;
    ghostThresholdDays: number;
    preferences: JobPreferences;
  };
  email: string;
}) {
  const [state, action] = useActionState<SettingsState, FormData>(updateProfile, {});
  const [editing, setEditing] = useCloseOnSuccess(state);
  const prefs = profile.preferences;

  return (
    <section className={cardVariants({ padding: 'standard' })}>
      <h2 className="text-body font-semibold text-ink">Job search</h2>
      <p className="mt-0.5 text-ui text-ink-muted">{email}</p>
      <p className="mt-2 text-small text-ink-muted">
        Your name and timezone are account settings now — they hold across every workspace, so they
        live under{' '}
        <a href="/account" className="font-medium text-accent underline underline-offset-2">
          Account
        </a>
        , and so does deleting the account, which was never the job search&rsquo;s to offer.
      </p>
      <p className="mt-2 text-small text-ink-muted">
        The titles you are aiming for and the industries never to suggest are on{' '}
        <a href="/jobs/find" className="font-medium text-accent underline underline-offset-2">
          Find
        </a>
        , beside the roles and people they shape.
      </p>

      {/* Read first. This was five labelled fields, three of them with a
          caption underneath, standing open every time the page loaded -- so a
          section whose values change perhaps twice in a job search greeted you
          as a form to fill in, and the settings themselves were never once
          simply shown (law 14). Editing is somewhere you go.

          The captions go with the form, which is the only place they are
          teaching anything; the read-out is the answers. */}
      {!editing ? (
        <div className="mt-4 space-y-2">
          <ValueList>
            <ValueRow label="Search started" value={profile.searchStartedOn} />
            <ValueRow label="Ghost after" value={`${profile.ghostThresholdDays} days of silence`} />
            <PreferenceRows prefs={prefs} />
          </ValueList>
          {state.message && <p className="text-ui text-ink-muted">{state.message}</p>}
          <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(true)}>
            Edit
          </Button>
        </div>
      ) : (
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

          {state.error && (
            <p role="alert" className="text-ui text-danger">
              {state.error}
            </p>
          )}
          {state.message && <p className="text-ui text-ink-muted">{state.message}</p>}

          <div className="flex items-center gap-2">
            <Button type="submit" size="sm">
              Save
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

/**
 * The four job preferences, each edited where it is read (law 12): where you
 * live and the pay floor are inline fields that save on leaving them, and the
 * workplaces and company stages are choices that save when pressed. Rules for
 * the roles Dash recommends: a posting that states pay below the floor, or a
 * workplace not chosen, is left out; none chosen means any.
 */
function PreferenceRows({ prefs }: { prefs: JobPreferences }) {
  return (
    <>
      <PreferenceText
        field="homeLocation"
        label="Where you live"
        value={prefs.homeLocation ?? ''}
        placeholder="New York, NY"
      />
      <PreferenceText
        field="salaryFloor"
        label="Lowest base pay"
        value={prefs.salaryFloorCents ? formatPay(prefs.salaryFloorCents) : ''}
        placeholder="120,000 a year"
        inputMode="numeric"
      />
      <PreferenceChoices
        field="workplaces"
        label="How you will work"
        options={WORKPLACE_PREFERENCES.map((value) => ({
          value,
          label: WORKPLACE_PREFERENCE_LABELS[value],
        }))}
        chosen={prefs.workplaces}
      />
      <PreferenceChoices
        field="companyStages"
        label="Company stages"
        options={COMPANY_STAGES.map((value) => ({ value, label: COMPANY_STAGE_LABELS[value] }))}
        chosen={prefs.companyStages}
      />
    </>
  );
}

/** A one-line preference: the value is the field, saved on Enter or on leaving it; Escape puts it back. */
function PreferenceText({
  field,
  label,
  value,
  placeholder,
  inputMode,
}: {
  field: 'homeLocation' | 'salaryFloor';
  label: string;
  value: string;
  placeholder: string;
  inputMode?: 'numeric';
}) {
  const [state, action] = useActionState<SettingsState, FormData>(savePreference, {});
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <ValueRow
      label={label}
      value={
        <form ref={formRef} action={action} className="-mx-1">
          <input type="hidden" name="field" value={field} />
          <InlineInput
            name="value"
            aria-label={label}
            defaultValue={value}
            placeholder={placeholder}
            inputMode={inputMode}
            aria-invalid={state.error ? true : undefined}
            onBlur={(event) => {
              if (event.currentTarget.value.trim() !== value) formRef.current?.requestSubmit();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              }
              if (event.key === 'Escape') {
                event.currentTarget.value = value;
                event.currentTarget.blur();
              }
            }}
          />
          {state.error && <p className="mt-1 px-1 text-small text-danger">{state.error}</p>}
        </form>
      }
    />
  );
}

/**
 * A multi-choice preference as a row of choices. Each is a submit button that
 * sends the current set and itself, so it works before JavaScript; a chosen
 * one is set in ink with a tick, the rest stay quiet (law 17).
 */
function PreferenceChoices({
  field,
  label,
  options,
  chosen,
}: {
  field: 'workplaces' | 'companyStages';
  label: string;
  options: { value: string; label: string }[];
  chosen: readonly string[];
}) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(savePreference, {});
  return (
    <ValueRow
      label={label}
      value={
        <form action={action} className="flex flex-wrap gap-x-1 gap-y-1">
          <input type="hidden" name="field" value={field} />
          {chosen.map((value) => (
            <input key={value} type="hidden" name="current" value={value} />
          ))}
          {options.map((option) => {
            const on = chosen.includes(option.value);
            return (
              <button
                key={option.value}
                type="submit"
                name="toggle"
                value={option.value}
                aria-pressed={on}
                disabled={pending}
                className={cn(
                  'press inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 text-ui',
                  on
                    ? 'bg-sunken font-medium text-ink'
                    : 'text-ink-muted hover:bg-sunken hover:text-ink',
                )}
              >
                {on && <Check className="size-3.5" strokeWidth={2} aria-hidden />}
                {option.label}
              </button>
            );
          })}
          {chosen.length === 0 && (
            <span className="self-center px-1 text-small text-ink-ghost">Any</span>
          )}
          {state.error && <p className="basis-full text-small text-danger">{state.error}</p>}
        </form>
      }
    />
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
        Read-only, scoped to a search query about recruiting mail. Message bodies are never stored.
        Subjects and senders are kept only for the messages that turn out to be relevant —
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
              Inbox scanning for the job search side is not connected yet — it needs its own Google
              grant, separate from the one the shopping side uses. Everything else works without it:
              add roles by pasting a job link, or use the capture bookmarklet.
            </p>
          )}
        </div>
      ) : (
        // Divides and space, no frame: the settings card around this already
        // said these belong together, and a bordered row inside it was the
        // second box arguing with the first. Law 11.
        <ul className="mt-4 divide-y divide-border">
          {accounts.map((account) => (
            <li key={account.id} className="row-pad">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-ui font-medium text-ink">{account.emailAddress}</span>
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-micro',
                    account.status === 'active'
                      ? // Connected is the ordinary state, so it is set quietly:
                        // it was wearing the offer hue, which law 4 gives to one
                        // stage of the pipeline and to nothing else, and green,
                        // which means money came back. Amber stays on the broken
                        // one, where "something is wrong and only you can fix it"
                        // is exactly what it means.
                        'bg-sunken text-ink-muted'
                      : 'bg-caution-tint text-ink',
                  )}
                >
                  {account.status.replace(/_/g, ' ')}
                </span>
                {/* Pushed right only where the row is wide enough to have a
                    right. At 390px `ml-auto` wrapped it onto a line of its own
                    and then held it against the far edge, so the date read as
                    an orphan rather than as a note about the address above. */}
                <span className="tabular text-small text-ink-muted sm:ml-auto">
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
        Your inbox is checked automatically <strong className="font-medium">once a day</strong>. Use{' '}
        <strong className="font-medium">Check now</strong> when you are expecting something — an
        interview invite is the one kind of mail where a day of delay actually costs you. Running it
        more often is free and never duplicates anything.
      </p>

      <p className="mt-2 text-micro leading-relaxed text-ink-muted">
        Coverage is partial by design. Recruiters emailing from a company address with a subject
        like &ldquo;quick question&rdquo; match no keyword, so a second pass searches the domains of
        the companies you track. Add domains on a company page when its mail is not linking, and
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
        setHref(`javascript:${encodeURIComponent(source.replace('__APP_ORIGIN__', origin))}`);
      })
      .catch(() => setHref(''));
  }, [appOrigin]);

  return (
    <section id="bookmarklet" className={cardVariants({ padding: 'standard' })}>
      <h2 className="text-body font-semibold text-ink">Capture application questions</h2>
      <p className="mt-0.5 text-ui leading-relaxed text-ink-muted">
        Drag this to your bookmarks bar. On an application form, click it: it reads the question
        labels and sends them here. It runs in your browser inside your session, which is why it
        works on Workday and iCIMS where nothing server-side can. It never reads what you have typed
        and never submits anything.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {href ? (
          // A link that has to look draggable, so it is drawn as the app's own
          // secondary button rather than as a box of its own -- same border
          // token, same height off the dial, same press. The accent ink is the
          // one thing kept: it is the only element on the page you are meant to
          // grab rather than click, and it sits next to a button you do click.
          <a
            href={href}
            onClick={(event) => event.preventDefault()}
            className={cn(
              buttonVariants({ variant: 'secondary', size: 'sm' }),
              'cursor-grab text-accent',
            )}
            title="Drag me to your bookmarks bar"
          >
            Capture questions
          </a>
        ) : (
          <span className="skeleton inline-block h-7 w-40" />
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
  const [adding, setAdding] = useCloseOnSuccess(state);
  const [, startTransition] = useTransition();

  return (
    <section className={cardVariants({ padding: 'standard' })}>
      <h2 className="text-body font-semibold text-ink">Excluded senders</h2>
      <p className="mt-0.5 text-ui leading-relaxed text-ink-muted">
        Mail from Indeed is already excluded everywhere for everyone — it is suggested jobs, not
        anything you applied to. Add a domain here for anything else that keeps showing up as a lead
        it should not be, like a job board or a newsletter.
      </p>

      {excludedSenders.length > 0 && (
        <ul className="mt-3 space-y-1">
          {excludedSenders.map((entry) => (
            <li key={entry.id} className="flex items-center gap-2 text-ui">
              <span className="tabular text-ink">{entry.domain}</span>
              <button
                type="button"
                className="ml-auto text-ink-muted hover:text-danger"
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

      {/* Behind a trigger, like every other add form on this page: the section
          is the list of domains, and a labelled empty box under it is a form
          on a page you came to read (law 14). */}
      {!adding ? (
        <AddTrigger label="Exclude a domain" onClick={() => setAdding(true)} className="mt-3" />
      ) : (
        <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <Label htmlFor="domain">Domain</Label>
            <Input id="domain" name="domain" autoFocus placeholder="jobs.example.com" />
          </div>
          <Button type="submit" size="sm" variant="secondary">
            Exclude
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </form>
      )}
      {state.error && <p className="mt-2 text-ui text-danger">{state.error}</p>}
      {state.message && <p className="mt-2 text-ui text-ink-muted">{state.message}</p>}
    </section>
  );
}
