'use client';

import { useActionState, useState, useTransition } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CardSection } from '@/components/ui/card';
import { FieldError, Input, Textarea } from '@/components/ui/field';
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
    // The id is the empty state's target on /shopping/share.
    <CardSection id="new-share" title="New shared form" className="h-fit scroll-mt-6">
      <form action={action} className="mt-1 space-y-3">
        <Input
          name="title"
          placeholder="Board games"
          required
          maxLength={120}
          aria-label="Title"
        />
        <Textarea
          name="intro"
          rows={3}
          maxLength={2000}
          placeholder="A note for whoever opens it."
          aria-label="A note for whoever opens it"
          className="min-h-0"
        />
        <Button type="submit" pending={pending} className="w-full">
          {pending ? 'Creating…' : 'Create'}
        </Button>
        <FieldError>{state.error}</FieldError>
        {state.message && <p className="text-ui text-ink-muted">{state.message}</p>}
      </form>
    </CardSection>
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
    <div className="row-pad flex flex-wrap items-center gap-2">
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
            {copied ? (
              <Check className="size-4" strokeWidth={1.75} aria-hidden />
            ) : (
              <Copy className="size-4" strokeWidth={1.75} aria-hidden />
            )}
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
