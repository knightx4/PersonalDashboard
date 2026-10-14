'use client';

import { useCallback, useEffect, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen, SquarePen } from 'lucide-react';
import Link from '@/components/ui/link';
import { IconButton, iconButtonVariants } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import { PageWide } from '@/components/shell/page-width';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';

/**
 * The conversation pattern (docs/UI-QUALITY-SPEC.md, Part 4; decision
 * #1899.1): a list of chats beside the open chat, as the Dash page at /ask
 * draws it.
 *
 * From 720 pixels wide the list sits on the left and the open chat beside it
 * at reading width, on a card, with its box at its foot. The list can be hidden, as in
 * other chat apps: the button above it folds it to a thin strip holding New
 * chat and the button to show it again, the chat then sits centred, and the
 * choice is kept on that device. A glance column on the right (what Dash read
 * and changed) joins later, and folds away the same way.
 *
 * Below 720 pixels the list is the page, and a chat opens over it: `open`
 * says a chat is open, and then only the chat is drawn, with its own way back
 * to the list. Each slot is drawn once and hidden by width, never twice.
 */

/** Where the list's open or hidden state is kept, per device. */
export const CONVERSATION_LIST_KEY = 'pt_conversation_list';

function readListOpen(key: string): boolean {
  try {
    return window.localStorage.getItem(key) !== 'hidden';
  } catch {
    return true;
  }
}

function keepListOpen(key: string, open: boolean) {
  try {
    window.localStorage.setItem(key, open ? 'shown' : 'hidden');
  } catch {
    /* Blocked storage: the list opens shown each visit. */
  }
}

export function Conversation({
  label,
  list,
  open,
  newChat,
  storageKey = CONVERSATION_LIST_KEY,
  initialListOpen,
  children,
}: {
  /** What the list is called, as its heading and the name of its landmark. */
  label: string;
  /** The list itself: what narrows it, then its rows. */
  list: React.ReactNode;
  /** A chat is open, so a phone shows it in place of the list. */
  open: boolean;
  /** Where New chat goes, and what it is called. */
  newChat: { href: string; label: string };
  storageKey?: string;
  /** For the gallery: start hidden or shown without reading storage. */
  initialListOpen?: boolean;
  /** The open chat. */
  children: React.ReactNode;
}) {
  const [listOpen, setListOpen] = useState(initialListOpen ?? true);
  useEffect(() => {
    if (initialListOpen !== undefined) return;
    // Read after hydration, so the server's render and the first client one agree.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- per-device storage is only readable here
    setListOpen(readListOpen(storageKey));
  }, [storageKey, initialListOpen]);

  const toggle = useCallback(
    (next: boolean) => {
      setListOpen(next);
      keepListOpen(storageKey, next);
    },
    [storageKey],
  );

  return (
    <PageWide
      className={cn(
        'grid grid-cols-1 min-[720px]:gap-x-6',
        listOpen ? 'min-[720px]:grid-cols-[16rem_minmax(0,1fr)] lg:grid-cols-[18rem_minmax(0,1fr)]' : 'min-[720px]:grid-cols-[2.75rem_minmax(0,1fr)]',
      )}
    >
      <aside
        aria-label={label}
        className={cn(
          'min-w-0 min-[720px]:sticky min-[720px]:top-16 min-[720px]:max-h-[calc(100dvh-6rem)] min-[720px]:self-start min-[720px]:overflow-y-auto',
          open && 'max-[719px]:hidden',
        )}
      >
        {/* The strip a hidden list leaves: New chat, and the way back. */}
        <div className={cn('hidden flex-col items-center gap-1', !listOpen && 'min-[720px]:flex')}>
          <Tooltip label={`Show ${label.toLowerCase()}`}>
            <IconButton label={`Show ${label.toLowerCase()}`} onClick={() => toggle(true)}>
              <PanelLeftOpen strokeWidth={1.75} aria-hidden />
            </IconButton>
          </Tooltip>
          <Tooltip label={newChat.label}>
            <Link
              href={newChat.href}
              aria-label={newChat.label}
              className={iconButtonVariants()}
            >
              <SquarePen strokeWidth={1.75} aria-hidden />
            </Link>
          </Tooltip>
        </div>

        <div className={cn(!listOpen && 'min-[720px]:hidden')}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-title font-semibold tracking-tight text-ink">{label}</h2>
            <span className="hidden min-[720px]:inline-flex">
              <Tooltip label={`Hide ${label.toLowerCase()}`} align="end">
                <IconButton label={`Hide ${label.toLowerCase()}`} onClick={() => toggle(false)}>
                  <PanelLeftClose strokeWidth={1.75} aria-hidden />
                </IconButton>
              </Tooltip>
            </span>
          </div>
          <div className="mt-2">{list}</div>
        </div>
      </aside>

      <section
        aria-label="Open chat"
        className={cn('min-w-0', !open && 'max-[719px]:hidden')}
      >
        {/* The chat on one card, so neither side of it sits bare on the page. */}
        <Card padding="standard" className="mx-auto w-full max-w-prose">{children}</Card>
      </section>
    </PageWide>
  );
}
