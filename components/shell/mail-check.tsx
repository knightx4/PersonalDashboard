'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import Link, { linkVariants } from '@/components/ui/link';
import { IconButton } from '@/components/ui/icon-button';
import { cn } from '@/lib/cn';
import { SectionLabel } from '@/components/ui/section-heading';
import { DashAction } from '@/components/ui/dash-action';
import { Tooltip } from '@/components/ui/tooltip';
import { deviceTimeZone, whenAgo } from '@/lib/core/when';
import {
  resultLine,
  workspaceCount,
  type MailCheckStatus,
  type MailWorkspace,
} from '@/lib/core/inbox/mail-check';

const CHECK_ACTION = 'app/api/inbox/check/route.ts#POST';
const POLL_MS = 2500;

/** Which button was pressed: one workspace's, or Check all. */
type Pressed = MailWorkspace['id'] | 'all';

function connectHref(returnTo: string): string {
  return `/api/auth/gmail/connect?return_to=${encodeURIComponent(returnTo)}`;
}

function secondsUntil(at: string, now: number): number {
  return Math.max(1, Math.ceil((new Date(at).getTime() - now) / 1000));
}

/**
 * Check mail, under Theme in the account menu (plan #3019).
 *
 * Mail is read on a schedule, so when the person is waiting on a reply there
 * was no way to make the app look now. Check all and each workspace's button
 * start the one sync the daily job runs, over every connected mailbox
 * (lib/core/inbox/mail-check.ts says why it is one pass), and the section
 * watches it until it ends, then re-reads the page so the new rows show
 * without a reload.
 *
 * It reads its state when the menu opens, not with the top bar, so the bar
 * costs no query. `initial` and `now` are for the gallery's pictures.
 */
export function MailCheck({
  workspaces,
  initial = null,
  now: fixedNow,
}: {
  /** The mail workspaces the account has switched on. */
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
  // cooldown's seconds.
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

  // When a check ends, re-read the page so what it found shows without a reload.
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
      const res = await fetch('/api/inbox/check', { method: 'POST' });
      const data = (await res.json()) as MailCheckStatus & { error?: string; joined?: boolean };
      if (data.mailboxes !== undefined) setStatus(data);
      if (data.joined) setNote('Already checking. This joins the check under way.');
      if (!res.ok && res.status !== 429) setError(data.error ?? 'Could not start the check.');
      else if (data.error && res.status !== 429) setError(data.error);
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

  if (status.mailboxes === 0) {
    return (
      <div>
        {heading}
        <Link href={connectHref(pathname ?? '/home')} className={cn(linkVariants(), 'text-ui')}>
          Connect Gmail
        </Link>
      </div>
    );
  }

  const busy = running || starting;
  const waitSeconds = status.nextAllowedAt && !busy ? secondsUntil(status.nextAllowedAt, now) : null;
  const blocked = busy || waitSeconds !== null;
  const timeZone = deviceTimeZone() ?? 'UTC';
  const when = running
    ? 'Checking…'
    : waitSeconds !== null
      ? `Again in ${waitSeconds} s`
      : status.lastCheckedAt
        ? `Last checked ${whenAgo(status.lastCheckedAt, { timeZone, now })}`
        : 'Not checked yet';

  return (
    <div>
      {heading}
      <div className="flex items-center gap-2">
        <DashAction
          variant="secondary"
          size="sm"
          paid={CHECK_ACTION}
          what="Cost of reading new mail"
          pending={busy && (pressed === 'all' || pressed === null)}
          disabled={blocked}
          onClick={() => void check('all')}
        >
          Check all
        </DashAction>
        <span className="tabular min-w-0 truncate text-small text-ink-muted" aria-live="polite">
          {when}
        </span>
      </div>

      <ul className="mt-2 flex flex-col">
        {workspaces.map((workspace) => {
          const result = status.linked ? resultLine(workspace, workspaceCount(workspace, status.linked)) : null;
          const spinning = busy && pressed === workspace.id;
          return (
            <li key={workspace.id} className="flex min-h-8 items-center gap-2">
              <span className="w-18 shrink-0 text-ui text-ink">{workspace.label}</span>
              <span className="min-w-0 flex-1 truncate text-small text-ink-muted">
                {spinning ? 'Checking…' : (result ?? '')}
              </span>
              <Tooltip label={`Check mail for ${workspace.label}`} align="end">
                <IconButton
                  size="sm"
                  label={`Check mail for ${workspace.label}`}
                  disabled={blocked}
                  aria-busy={spinning || undefined}
                  onClick={() => void check(workspace.id)}
                  className="shrink-0"
                >
                  <RefreshCw
                    aria-hidden
                    strokeWidth={1.75}
                    className={cn(spinning && 'motion-safe:animate-spin')}
                  />
                </IconButton>
              </Tooltip>
            </li>
          );
        })}
      </ul>

      {note && <p className="mt-1 text-small text-ink-muted">{note}</p>}
      {(error || status.problems.length > 0) && (
        <ul className="mt-1.5 flex flex-col gap-1" aria-live="polite">
          {error && <li className="text-small text-danger">{error}</li>}
          {status.problems.map((problem) => (
            <li
              key={`${problem.kind}-${problem.email ?? ''}`}
              className={cn('text-small', problem.kind === 'importing' ? 'text-ink-muted' : 'text-danger')}
            >
              {problem.message}{' '}
              {problem.kind === 'reconnect' && (
                <Link href={connectHref(pathname ?? '/home')} className={linkVariants()}>
                  Reconnect Gmail
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
