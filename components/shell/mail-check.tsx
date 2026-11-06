'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import Link, { linkVariants } from '@/components/ui/link';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { SectionLabel } from '@/components/ui/section-heading';
import { DashAction } from '@/components/ui/dash-action';
import { Tooltip } from '@/components/ui/tooltip';
import { deviceTimeZone, whenAgo } from '@/lib/core/when';
import {
  canStart,
  mailboxLine,
  type MailboxCheck,
  type MailCheckStatus,
  type MailWorkspace,
} from '@/lib/core/inbox/mail-check';

const CHECK_ACTION = 'app/api/inbox/check/route.ts#POST';
const POLL_MS = 2500;

/** Which button was pressed: one mailbox's (by its id), or Check all. */
type Pressed = string | 'all';

function connectHref(returnTo: string, email?: string): string {
  const hint = email ? `&login_hint=${encodeURIComponent(email)}` : '';
  return `/api/auth/gmail/connect?return_to=${encodeURIComponent(returnTo)}${hint}`;
}

function secondsUntil(at: string, now: number): number {
  return Math.max(1, Math.ceil((new Date(at).getTime() - now) / 1000));
}

/**
 * Check mail, under Theme in the account menu (plans #3019, #3019.1).
 *
 * Mail is read on a schedule, so when the person is waiting on a reply there
 * was no way to make the app look now. Each connected mailbox has a button
 * labelled with its address, which checks that mailbox for every workspace
 * that reads mail, and Check all checks each of them. Both start the sync the
 * daily job runs (lib/core/inbox/mail-check.ts says why per mailbox and never
 * per workspace). The section watches the checks until they end, then
 * re-reads the page so the new rows show without a reload.
 *
 * It reads its state when the menu opens, not with the top bar, so the bar
 * costs no query. `initial` and `now` are for the gallery's pictures.
 */
export function MailCheck({
  workspaces,
  initial = null,
  now: fixedNow,
}: {
  /** The mail workspaces the account has switched on, which name a result's breakdown. */
  workspaces: readonly MailWorkspace[];
  initial?: MailCheckStatus | null;
  now?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<MailCheckStatus | null>(initial);
  const [pressed, setPressed] = useState<Pressed | null>(null);
  const [starting, setStarting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => fixedNow ?? Date.now());
  const now = fixedNow ?? clock;

  const load = useCallback(() => {
    fetch('/api/inbox/check', { cache: 'no-store' })
      .then((res) => (res.ok ? (res.json() as Promise<MailCheckStatus>) : null))
      .then((next) => {
        if (next) setStatus(next);
      })
      // A missed poll is caught by the next one.
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (initial) return;
    load();
  }, [initial, load]);

  const running = status?.running ?? false;

  // While a check runs, ask after it; the clock ticks for "2 min ago" and the
  // minute's seconds.
  useEffect(() => {
    if (fixedNow !== undefined) return;
    const tick = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [fixedNow]);
  useEffect(() => {
    if (!running || initial) return;
    const poll = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(poll);
  }, [running, initial, load]);

  // When the checks end, re-read the page so what they found shows without a reload.
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) {
      router.refresh();
      setNote(null);
    }
    wasRunning.current = running;
  }, [running, router]);

  async function check(which: Pressed) {
    setPressed(which);
    setStarting(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch('/api/inbox/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(which === 'all' ? {} : { mailboxId: which }),
      });
      const data = (await res.json()) as Partial<MailCheckStatus> & { error?: string; joined?: boolean };
      if (data.mailboxes) setStatus({ mailboxes: data.mailboxes, running: data.running ?? false });
      if (data.joined) setNote('Already checking. This joins the check under way.');
      if (data.error) setError(data.error);
      else if (!res.ok) setError('Could not start the check.');
    } catch {
      setError('Could not reach the app to start the check. Try again.');
    } finally {
      setStarting(false);
    }
  }

  if (workspaces.length === 0) return null;

  const heading = <SectionLabel className="pb-1.5">Check mail</SectionLabel>;

  if (!status) {
    return (
      <div aria-busy="true">
        {heading}
        <p className="text-small text-ink-muted">Looking at your mailboxes…</p>
      </div>
    );
  }

  const returnTo = pathname ?? '/home';

  if (status.mailboxes.length === 0) {
    return (
      <div>
        {heading}
        <Link href={connectHref(returnTo)} className={cn(linkVariants(), 'text-ui')}>
          Connect Gmail
        </Link>
      </div>
    );
  }

  const timeZone = deviceTimeZone() ?? 'UTC';
  const anyStartable = status.mailboxes.some(canStart);
  // Check all waits out the minute only when every mailbox it could start is waiting.
  const soonest = status.mailboxes
    .filter((m) => m.checkable && !m.running && m.nextAllowedAt)
    .map((m) => m.nextAllowedAt as string)
    .sort()[0];
  const allSummary = running
    ? 'Checking…'
    : !anyStartable && soonest
      ? `Again in ${secondsUntil(soonest, now)} s`
      : null;

  function whenLine(m: MailboxCheck): string {
    if (m.running) return 'Checking…';
    if (m.nextAllowedAt) return `Again in ${secondsUntil(m.nextAllowedAt, now)} s`;
    if (!m.lastCheckedAt) return 'Not checked yet';
    return `Last checked ${whenAgo(m.lastCheckedAt, { timeZone, now })}`;
  }

  // A note or error from a press goes under what was pressed.
  const message = (which: Pressed) =>
    pressed === which && (error || note) ? (
      <p className={cn('px-2 text-small', error ? 'text-danger' : 'text-ink-muted')} aria-live="polite">
        {error ?? note}
      </p>
    ) : null;

  return (
    <div>
      {heading}
      <div className="flex items-center gap-2">
        <DashAction
          variant="secondary"
          size="sm"
          paid={CHECK_ACTION}
          what="Cost of reading new mail"
          pending={starting && pressed === 'all'}
          disabled={starting || !anyStartable}
          onClick={() => void check('all')}
        >
          Check all
        </DashAction>
        <span className="tabular min-w-0 truncate text-small text-ink-muted" aria-live="polite">
          {allSummary}
        </span>
      </div>
      {message('all')}

      <ul className="-mx-2 mt-2 flex flex-col gap-1">
        {status.mailboxes.map((m) => {
          const spinning = m.running || (starting && pressed === m.id);
          const held = starting || !canStart(m);
          const line = mailboxLine(whenLine(m), workspaces, m.running ? null : m.linked);
          return (
            <li key={m.id}>
              <Tooltip label={`Check ${m.email} for new mail`} align="end" className="flex">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={held}
                  aria-busy={spinning || undefined}
                  onClick={() => void check(m.id)}
                  // The address names the row, so it stays readable while the
                  // button waits; the icon fades to say it cannot be pressed.
                  className="w-full min-w-0 justify-between px-2 text-ink disabled:opacity-100"
                >
                  <span className="min-w-0 truncate">{m.email}</span>
                  <RefreshCw
                    aria-hidden
                    strokeWidth={1.75}
                    className={cn(
                      'size-4 shrink-0 text-ink-muted',
                      held && !spinning && 'opacity-50',
                      spinning && 'motion-safe:animate-spin',
                    )}
                  />
                </Button>
              </Tooltip>
              {(m.checkable || (m.lastCheckedAt && m.problem?.kind !== 'importing')) && (
                <p className="tabular truncate px-2 text-small text-ink-muted" aria-live="polite">
                  {line}
                </p>
              )}
              {m.problem && (
                <p
                  className={cn('px-2 text-small', m.problem.kind === 'importing' ? 'text-ink-muted' : 'text-danger')}
                >
                  {m.problem.message}{' '}
                  {m.problem.kind === 'reconnect' && (
                    <Link href={connectHref(returnTo, m.email)} className={linkVariants()}>
                      Reconnect
                    </Link>
                  )}
                </p>
              )}
              {message(m.id)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
