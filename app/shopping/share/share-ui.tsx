'use client';

import { useActionState, useRef, useState, useTransition } from 'react';
import { Check, Copy, Plus } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { FieldError, Input, Textarea } from '@/components/ui/field';
import { Popover } from '@/components/ui/popover';
import { usePopover } from '@/lib/use-popover';
import {
  archiveShare,
  createShare,
  issueShareToken,
  regroup,
  revokeShareToken,
  type ShareActionState,
} from './actions';

/**
 * The page's one action: a New button in the header that opens the name box
 * under it (plan #1789). The title is all it needs; the note for whoever
 * opens the form is optional, and creating it goes straight to the new form,
 * where the things go on it.
 *
 * A plain button carrying the button's look rather than `Button`, because the
 * popover needs a ref on the trigger to hand focus back to it on close.
 */
export function NewShareButton() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ShareActionState, FormData>(createShare, {});
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  usePopover({ open, onClose: () => setOpen(false), panelRef, triggerRef });

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        className={buttonVariants({ variant: 'primary', size: 'sm' })}
      >
        <Plus className="size-4" strokeWidth={2} aria-hidden />
        New form
      </button>
      {open && (
        <Popover
          ref={panelRef}
          role="dialog"
          aria-label="New shared form"
          padding="panel"
          className="sm:w-80"
        >
          <form action={action} className="space-y-3 max-sm:[&_input]:min-h-11">
            <Input
              name="title"
              placeholder="Board games"
              required
              maxLength={120}
              aria-label="Title"
            />
            <Textarea
              name="intro"
              rows={2}
              maxLength={2000}
              placeholder="A note for whoever opens it (optional)"
              aria-label="A note for whoever opens it"
              className="min-h-0"
            />
            <Button type="submit" pending={pending} className="w-full">
              {pending ? 'Creating…' : 'Create'}
            </Button>
            <FieldError>{state.error}</FieldError>
          </form>
        </Popover>
      )}
    </div>
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
    <div className="row-pad space-y-2">
      <div className="min-w-0">
        <p className="flex text-ui text-ink" title={url}>
          {/* One line at any width: the middle gives way, both ends stay. */}
          <span className="min-w-0 truncate">{url.slice(0, -8)}</span>
          <span className="shrink-0">{url.slice(-8)}</span>
        </p>
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
        <div className="flex items-center gap-2">
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
        </div>
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
