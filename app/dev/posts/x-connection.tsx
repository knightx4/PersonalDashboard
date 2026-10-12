'use client';

import { useState, useTransition } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { ConfirmStep } from '@/components/ui/confirm-step';
import Link from '@/components/ui/link';
import { cn } from '@/lib/cn';
import { planHref } from '@/lib/search/sources/dev-map';
import type { XConnectionView, XConnectNotice } from '@/lib/x/account';
import { X_CONNECT_PATH } from '@/lib/x/routes';
import { checkX, disconnectX } from './actions';

/**
 * The X connection on the Posts tab (plan #1818): who the dashboard reads
 * posts as, with Connect X when nobody, Connect X again when X stopped
 * accepting the sign-in, and a line pointing at the setup step while the X
 * app's keys are not set.
 *
 * Connect X is a plain link to /api/x/connect, since the round trip leaves
 * the app for X and comes back to this tab.
 *
 * Connected, the row offers Check X now (plan #1819), the daily read run on
 * demand, and says why the last read stopped when X stopped it: a rate
 * limit, no credit left, or a refusal.
 */

function ConnectLink({ label }: { label: string }) {
  return (
    // A route handler that redirects to X, so a full navigation, not a client one.
    <a href={X_CONNECT_PATH} className={buttonVariants({ variant: 'secondary' })}>
      {label}
    </a>
  );
}

/** Check X now: the read, on demand, with what it found said beneath the row. */
function CheckX({ onResult }: { onResult: (r: { ok: boolean; text: string }) => void }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      pending={pending}
      onClick={() =>
        start(async () => {
          const r = await checkX();
          onResult({ ok: r.ok, text: (r.ok ? r.message : r.error) ?? '' });
        })
      }
    >
      {pending ? 'Checking X…' : 'Check X now'}
    </Button>
  );
}

function lastRead(at: string | null): string {
  if (!at) return 'No posts read yet';
  const day = new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `Posts last read ${day}`;
}

export function XConnection({
  view,
  notice,
}: {
  view: XConnectionView;
  notice?: XConnectNotice | null;
}) {
  const [checked, setChecked] = useState<{ ok: boolean; text: string } | null>(null);
  let body: React.ReactNode;
  let action: React.ReactNode = null;
  let problem: string | null = null;

  switch (view.state) {
    case 'unconfigured':
      body = (
        <>
          <p className="text-ui font-medium text-ink">X is not connected</p>
          <p className="text-small text-ink-muted">
            Connecting needs the X app&rsquo;s keys, which are not set yet.{' '}
            <Link href={planHref(view.setupStep)} className="font-medium text-accent hover:underline">
              Step #{view.setupStep} says how to set them.
            </Link>
          </p>
        </>
      );
      break;
    case 'none':
      body = (
        <>
          <p className="text-ui font-medium text-ink">X is not connected</p>
          <p className="text-small text-ink-muted">
            Connect your X account so the drafts you post are marked posted without pasting the link.
          </p>
        </>
      );
      action = <ConnectLink label="Connect X" />;
      break;
    case 'disconnected':
      body = (
        <>
          <p className="text-ui font-medium text-ink">X stopped accepting the sign-in for @{view.handle}</p>
          <p className="text-small text-ink-muted">Connect again to keep reading your posts.</p>
        </>
      );
      action = <ConnectLink label="Connect X again" />;
      break;
    case 'connected':
      body = (
        <>
          <p className="text-ui font-medium text-ink">Connected to X as @{view.handle}</p>
          <p className="text-small text-ink-muted">{lastRead(view.lastSyncedAt)}</p>
        </>
      );
      // What Check X now just said replaces the stored line it answers.
      problem = checked ? null : (view.problem ?? null);
      action = (
        <div className="flex flex-wrap items-center gap-2">
          <CheckX onResult={setChecked} />
          <ConfirmStep
            action={disconnectX}
            prompt="Removes the X sign-in. Posts already read stay."
            confirmLabel="Disconnect"
            pendingLabel="Disconnecting…"
            variant="ghost"
          >
            Disconnect
          </ConfirmStep>
        </div>
      );
      break;
  }

  return (
    <section aria-label="X account" className={cn(cardVariants({ padding: 'dense' }), 'space-y-2')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-0.5">{body}</div>
        {action}
      </div>
      {problem && <p className="text-small text-caution">{problem}</p>}
      {checked && (
        <p role={checked.ok ? 'status' : 'alert'} className={cn('text-small', checked.ok ? 'text-ink-muted' : 'text-caution')}>
          {checked.text}
        </p>
      )}
      {notice && (
        <p
          role={notice.tone === 'problem' ? 'alert' : 'status'}
          className={cn('text-small', notice.tone === 'problem' ? 'text-caution' : 'text-ink-muted')}
        >
          {notice.text}
        </p>
      )}
    </section>
  );
}
