'use client';

import { useActionState, useState, useTransition } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/field';
import {
  archiveShare,
  createShare,
  issueShareToken,
  regroup,
  revokeShareToken,
  type ShareActionState,
} from './actions';

export function CreateShareForm() {
  const [state, action, pending] = useActionState<ShareActionState, FormData>(createShare, {});

  return (
    <Card className="h-fit p-4">
      <h2 className="text-body font-semibold text-ink">New shared form</h2>
      <form action={action} className="mt-3 space-y-3">
        <Input name="title" placeholder="Board games" required maxLength={120} />
        <textarea
          name="intro"
          rows={3}
          maxLength={2000}
          placeholder="A note for whoever opens it."
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-body text-ink placeholder:text-ink-ghost focus-visible:outline-2 focus-visible:outline-offset-2"
        />
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? 'Creating…' : 'Create'}
        </Button>
        {state.error && <p className="text-ui text-danger">{state.error}</p>}
        {state.message && <p className="text-ui text-ink-muted">{state.message}</p>}
      </form>
    </Card>
  );
}

/**
 * The link, and the one control that matters next to it.
 *
 * Copy is a button rather than selectable text because this gets sent from a
 * phone, and a long unguessable token is the worst possible thing to select by
 * hand.
 */
export function ShareLinkRow({
  url,
  label,
  tokenId,
  revoked,
  lastSeenAt,
}: {
  url: string;
  label: string;
  tokenId: string;
  revoked: boolean;
  lastSeenAt: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-ui text-ink">{url}</p>
        <p className="text-small text-ink-muted">
          {label}
          {revoked
            ? ' · revoked'
            : lastSeenAt
              ? ` · last answered ${new Date(lastSeenAt).toLocaleDateString()}`
              : ' · not opened yet'}
        </p>
      </div>
      {!revoked && (
        <>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              navigator.clipboard.writeText(url).then(
                () => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                },
                () => setCopied(false),
              );
            }}
          >
            {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={pending}
            onClick={() => startTransition(() => void revokeShareToken(tokenId))}
          >
            Revoke
          </Button>
        </>
      )}
    </div>
  );
}

export function ShareControls({ shareId, archived }: { shareId: string; archived: boolean }) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  function run(fn: () => Promise<ShareActionState>) {
    startTransition(async () => {
      const result = await fn();
      setNote(result.error ?? result.message ?? null);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() => run(() => issueShareToken(shareId))}
      >
        New link
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() => run(() => regroup(shareId))}
      >
        Regroup
      </Button>
      {!archived && (
        <Button
          size="sm"
          variant="danger"
          disabled={pending}
          onClick={() => run(() => archiveShare(shareId))}
        >
          Archive
        </Button>
      )}
      {note && <span className="text-ui text-ink-muted">{note}</span>}
    </div>
  );
}
