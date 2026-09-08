'use client';

import { useState, useTransition } from 'react';
import { Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { popoverSurface } from '@/components/ui/popover';
import { cn } from '@/lib/cn';
import { addToShare } from '@/app/shopping/share/actions';

export type ShareOption = { id: string; title: string };

/**
 * Put things on a shared form from wherever they are.
 *
 * One button on the inventory row and the item page, one on the list with
 * whatever the filters have narrowed to. The list case deliberately sends the
 * ids on screen rather than re-running the filter on the server: what gets
 * added is then exactly what was being looked at, and no phrasing of a filter
 * can quietly mean something different a second later.
 */
export function SendToShare({
  shares,
  inventoryItemIds,
  label,
  size = 'sm',
}: {
  shares: ShareOption[];
  inventoryItemIds: string[];
  label?: string;
  size?: 'sm' | 'md';
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (shares.length === 0 || inventoryItemIds.length === 0) return null;

  const count = inventoryItemIds.length;
  const text = label ?? (count === 1 ? 'Send to form' : `Send ${count} to a form`);

  function send(shareId: string) {
    setOpen(false);
    startTransition(async () => {
      const result = await addToShare({ shareId, inventoryItemIds });
      setNote(result.error ?? result.message ?? null);
      setTimeout(() => setNote(null), 4000);
    });
  }

  if (note) return <span className="text-ui text-ink-muted">{note}</span>;

  // A single share is the common case and does not deserve a menu.
  if (shares.length === 1) {
    return (
      <Button
        size={size}
        variant="secondary"
        pending={pending}
        onClick={() => send(shares[0]!.id)}
      >
        <Share2 className="size-4" strokeWidth={1.75} aria-hidden />
        {pending ? 'Adding…' : text}
      </Button>
    );
  }

  return (
    <div className="relative">
      <Button size={size} variant="secondary" pending={pending} onClick={() => setOpen(!open)}>
        <Share2 className="size-4" strokeWidth={1.75} aria-hidden />
        {pending ? 'Adding…' : text}
      </Button>
      {/* The shared floating surface. `Popover` itself does not fit -- both of
          its anchors assume the top bar, and this hangs off a button in a list
          row -- but the shape is exported for exactly that, the way
          `cardVariants` is. What it brings over the hand-drawn version is
          `bg-raised`, which is the token for something above the page and the
          only one that is a lit sheet under Lightbox; `bg-surface` here was
          the same colour as the card underneath it in every theme. */}
      {open && (
        <ul className={cn(popoverSurface, 'absolute right-0 z-20 mt-1 min-w-48 p-1')}>
          {shares.map((share) => (
            <li key={share.id}>
              <button
                type="button"
                onClick={() => send(share.id)}
                className="press w-full rounded-control px-2.5 py-1.5 text-left text-ui text-ink transition-colors duration-150 hover:bg-sunken"
              >
                {share.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
