'use client';

import { useCallback, useEffect, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen, PanelRight, PanelRightClose, PanelRightOpen, SquarePen, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { scrim } from '@/components/ui/popover';
import Link from '@/components/ui/link';
import { IconButton, iconButtonVariants } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import { PageWide } from '@/components/shell/page-width';
import { Card } from '@/components/ui/card';
import { BackLink } from '@/components/shell/back-link';
import { Breadcrumb, type Crumb } from '@/components/shell/breadcrumb';
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
 * choice is kept on that device. The open chat is drawn by
 * `ConversationChat`, which puts the glance column (what Dash read and
 * changed, plan #1899.4) on its right and folds it away the same way.
 *
 * Below 720 pixels the list is the page, and a chat opens over it: `open`
 * says a chat is open, and then only the chat is drawn, with its own way back
 * to the list. Each slot is drawn once and hidden by width, never twice.
 */

/** Where the list's open or hidden state is kept, per device. */
export const CONVERSATION_LIST_KEY = 'pt_conversation_list';

/**
 * A pane's height when the panes fill the window (`fill`): the window less the
 * shell's top bar and the page's own padding, the same room the sticky list
 * has always measured.
 */
const PANE_H = 'min-[720px]:h-[calc(100dvh-6rem)]';

/** Where the glance column's open or folded state is kept, per device. */
export const CONVERSATION_GLANCE_KEY = 'pt_conversation_glance';

function readOpen(key: string): boolean {
  try {
    return window.localStorage.getItem(key) !== 'hidden';
  } catch {
    return true;
  }
}

function keepOpen(key: string, open: boolean) {
  try {
    window.localStorage.setItem(key, open ? 'shown' : 'hidden');
  } catch {
    /* Blocked storage: the list and the column open shown each visit. */
  }
}

export function Conversation({
  label,
  list,
  open,
  newChat,
  storageKey = CONVERSATION_LIST_KEY,
  initialListOpen,
  fill = false,
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
  /**
   * The list on a pane of its own, as tall as the window, scrolling inside
   * it; pair with ConversationChat's `fill` (the Dash page).
   */
  fill?: boolean;
  /** The open chat, drawn by ConversationChat. */
  children: React.ReactNode;
}) {
  const [listOpen, setListOpen] = useState(initialListOpen ?? true);
  useEffect(() => {
    if (initialListOpen !== undefined) return;
    // Read after hydration, so the server's render and the first client one agree.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- per-device storage is only readable here
    setListOpen(readOpen(storageKey));
  }, [storageKey, initialListOpen]);

  const toggle = useCallback(
    (next: boolean) => {
      setListOpen(next);
      keepOpen(storageKey, next);
    },
    [storageKey],
  );

  return (
    <PageWide
      className={cn(
        'grid grid-cols-1 min-[720px]:gap-x-6',
        listOpen ? 'min-[720px]:grid-cols-[16rem_minmax(0,1fr)] lg:grid-cols-[18rem_minmax(0,1fr)]' : 'min-[720px]:grid-cols-[2.75rem_minmax(0,1fr)]',
        fill && 'min-[720px]:gap-x-3',
        fill && listOpen && 'lg:grid-cols-[20rem_minmax(0,1fr)]',
      )}
    >
      <aside
        aria-label={label}
        className={cn(
          'min-w-0 min-[720px]:sticky min-[720px]:top-16 min-[720px]:max-h-[calc(100dvh-6rem)] min-[720px]:self-start min-[720px]:overflow-y-auto',
          // A pane of its own, the height of the chat beside it.
          fill && listOpen && cn('min-[720px]:sheet min-[720px]:rounded-card min-[720px]:bg-surface min-[720px]:p-3', PANE_H),
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
        // A container, so the glance column sits beside the chat only where
        // the chat keeps its room: with the list shown on a laptop it opens
        // as a sheet instead.
        className={cn('@container/chat min-w-0', !open && 'max-[719px]:hidden')}
      >
        {children}
      </section>
    </PageWide>
  );
}

/**
 * The open chat in the conversation pattern (plans #1899.2, #1899.4): its
 * title, then the thread, on one card at reading width, and the glance
 * column beside it when there is one. On a phone the way back to the list
 * sits above the title with the column's button beside it, so the title
 * keeps the card's whole width.
 *
 * The column sits on the right once the chat's own space is 48rem wide, so
 * the chat keeps at least about 32rem; a button in the chat's header folds
 * it away and the choice is kept on that device. Where there is less room (a
 * laptop with the list shown, a phone) the same button opens the column as a
 * sheet from the right. The sheet is drawn only while open.
 */
export function ConversationChat({
  title,
  back,
  crumbs,
  glance,
  storageKey = CONVERSATION_GLANCE_KEY,
  initialGlanceOpen,
  initialSheetOpen = false,
  fill = false,
  children,
}: {
  /** The chat's title. */
  title: string;
  /** On a phone, the way back to the list the chat is drawn over. */
  back: { href: string; label: string };
  /**
   * The chat's path (plan #1931.2), drawn above its title from 720 pixels
   * wide; on a phone the back link names where `from` or `back` goes.
   */
  crumbs?: readonly Crumb[];
  /** The column of what was used, with its name and its short name for the button. */
  glance?: { label: string; short: string; content: React.ReactNode };
  storageKey?: string;
  /** For the gallery: start folded or shown without reading storage. */
  initialGlanceOpen?: boolean;
  /** For the gallery: draw the sheet open. */
  initialSheetOpen?: boolean;
  /**
   * The chat as a pane the height of the window, its title fixed at the top
   * and the thread scrolling under it, so a docked box sits at its foot; the
   * column of what was used is a pane of the same height (the Dash page).
   */
  fill?: boolean;
  /** The thread. */
  children: React.ReactNode;
}) {
  const [glanceOpen, setGlanceOpen] = useState(initialGlanceOpen ?? true);
  const [sheetOpen, setSheetOpen] = useState(initialSheetOpen);
  useEffect(() => {
    if (initialGlanceOpen !== undefined) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- per-device storage is only readable here
    setGlanceOpen(readOpen(storageKey));
  }, [storageKey, initialGlanceOpen]);

  useEffect(() => {
    if (!sheetOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setSheetOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [sheetOpen]);

  const toggleGlance = useCallback(() => {
    const next = !glanceOpen;
    setGlanceOpen(next);
    keepOpen(storageKey, next);
  }, [glanceOpen, storageKey]);

  const beside = glance && glanceOpen;
  const name = glance?.label.toLowerCase() ?? '';

  // One item, so the tooltip's wrapper around the hidden button takes no place of its own.
  const glanceButtons = glance && (
    <span className="flex shrink-0 items-center">
      {/* Where the column has no room: it opens as a sheet. */}
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0 @min-[48rem]/chat:hidden"
        aria-haspopup="dialog"
        aria-expanded={sheetOpen}
        onClick={() => setSheetOpen(true)}
      >
        <PanelRight className="size-4" strokeWidth={1.75} aria-hidden />
        {glance.short}
      </Button>
      {/* Where it has: the column folds away and comes back. */}
      <Tooltip label={glanceOpen ? `Hide ${name}` : `Show ${name}`} align="end">
        <Button
          variant="ghost"
          size="sm"
          pressed={glanceOpen}
          className="hidden shrink-0 @min-[48rem]/chat:inline-flex"
          aria-expanded={glanceOpen}
          aria-label={glanceOpen ? `Hide ${name}` : `Show ${name}`}
          onClick={toggleGlance}
        >
          {glanceOpen ? (
            <PanelRightClose className="size-4" strokeWidth={1.75} aria-hidden />
          ) : (
            <PanelRightOpen className="size-4" strokeWidth={1.75} aria-hidden />
          )}
          {glance.short}
        </Button>
      </Tooltip>
    </span>
  );

  return (
    <div
      className={cn(
        'grid grid-cols-1',
        fill ? 'gap-x-3' : 'gap-x-6',
        beside && (fill ? '@min-[48rem]/chat:grid-cols-[minmax(0,1fr)_17rem]' : '@min-[48rem]/chat:grid-cols-[minmax(0,1fr)_15rem]'),
      )}
    >
      {/* The chat on one card, so neither side of it sits bare on the page. */}
      <Card
        padding={fill ? 'none' : 'standard'}
        className={cn(
          'mx-auto w-full min-w-0',
          fill ? cn('flex flex-col min-[720px]:sticky min-[720px]:top-16', PANE_H) : 'max-w-prose',
        )}
      >
        <div className={cn(fill ? 'shrink-0 border-b border-border px-(--card-p) py-3 max-[719px]:pt-(--card-p)' : 'mb-4')}>
          <div className="mb-1 flex items-center justify-between gap-2 min-[720px]:hidden">
            <BackLink crumbs={crumbs ?? []} fallback={back} />
            {glanceButtons}
          </div>
          {crumbs && crumbs.length > 0 && <Breadcrumb crumbs={crumbs} className="mb-1 hidden min-[720px]:flex" />}
          <div className="flex items-start gap-2">
            <h1 className="font-display line-clamp-2 min-w-0 flex-1 break-words text-title font-semibold tracking-tight text-ink">
              {title}
            </h1>
            <span className="hidden shrink-0 min-[720px]:flex">{glanceButtons}</span>
          </div>
        </div>
        {fill ? (
          // The thread scrolls here, under the title; the box docks at its foot.
          <div className="min-h-0 flex-1 px-(--card-p) pt-5 [scrollbar-gutter:stable] min-[720px]:overflow-y-auto">
            <div className="mx-auto flex min-h-full w-full max-w-prose flex-col">{children}</div>
          </div>
        ) : (
          children
        )}
      </Card>

      {beside && (
        <aside
          aria-label={glance.label}
          className="hidden min-w-0 @min-[48rem]/chat:sticky @min-[48rem]/chat:top-16 @min-[48rem]/chat:block @min-[48rem]/chat:max-h-[calc(100dvh-6rem)] @min-[48rem]/chat:self-start @min-[48rem]/chat:overflow-y-auto"
        >
          {/* On a card of its own, as the chat is; its heading a label, so the chat's title is the one title. */}
          <Card padding="standard" className={cn(fill && 'min-h-[calc(100dvh-6rem)]')}>
            <h2 className="text-ui font-semibold text-ink">{glance.label}</h2>
            <div className="mt-3">{glance.content}</div>
          </Card>
        </aside>
      )}

      {glance && sheetOpen && (
        <div className="fixed inset-0 z-overlay" role="dialog" aria-modal="true" aria-label={glance.label}>
          <button type="button" aria-label={`Close ${name}`} onClick={() => setSheetOpen(false)} className={scrim} />
          <div className="absolute inset-y-0 right-0 flex w-[min(22rem,88vw)] flex-col border-l border-border bg-surface">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-ui font-semibold text-ink">{glance.label}</h2>
              <Tooltip label={`Close ${name}`} align="end">
                <IconButton label={`Close ${name}`} onClick={() => setSheetOpen(false)}>
                  <X strokeWidth={1.75} aria-hidden />
                </IconButton>
              </Tooltip>
            </div>
            <div className="flex-1 overflow-y-auto p-4">{glance.content}</div>
          </div>
        </div>
      )}
    </div>
  );
}
