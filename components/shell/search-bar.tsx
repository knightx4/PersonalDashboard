'use client';

import { Search } from 'lucide-react';
import { Kbd } from '@/components/shell/key-hints';

/**
 * ⌘K, or Ctrl+K off a Mac: the key that opens the search box at any width.
 * Read by the shell's listener, and here so it can be tested without a page.
 */
export function isSearchShortcut(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>): boolean {
  return (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
}

/**
 * The search field in the top bar, from lg up.
 *
 * It looks like a field and is a button: pressing it opens the search box
 * over the page, searching everything you own, which is what ⌘K and the
 * phone's search button open too (plan #1363). It used to be a field you typed
 * into, with a short list dropping under it and a chip keeping it to the
 * workspace the page is in; the person asked for the reverse, because the
 * field you can see should find anything you have written.
 *
 * A button rather than an input that opens the box on focus: moving the
 * keyboard past a control should not throw a dialog over the page (WCAG 3.2.1),
 * and focus coming back here when the box closes would open it again. Enter or
 * Space on it opens the box like a click.
 *
 * What the box searches and how it starts is the shell's and the box's
 * (components/shell/app-shell.tsx and command-palette.tsx). This file only
 * draws the way in.
 */
export function SearchBar({
  onOpen,
  className,
}: {
  /** Open the search box. The shell holds whether it is up. */
  onOpen: () => void;
  /** The width the bar is given, which is the top bar's business rather than this file's. */
  className?: string;
}) {
  return (
    <div className={className}>
      {/* A control's own edge rather than a frame around a group (the ui-ok
        * on the class line below). `border-control` is the 3:1 token a field owes under
        * WCAG 1.4.11, and here it is the only thing saying this is where you
        * search. Card and Group are content surfaces with no focus state.
        *
        * No ground of its own and a full radius. It had the surface fill every
        * other field has, which on the top bar's own ground read as a slab
        * laid across it rather than as one control among the icons beside it
        * -- note ca910aa3. */}
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        aria-keyshortcuts="Meta+K Control+K"
        /* ui-ok: hand-rolled-box -- a field's own edge, explained above */
        className="flex h-(--control-h) w-full items-center gap-2 rounded-full border border-control bg-transparent px-(--control-px) text-left transition-colors hover:border-border-strong"
      >
        <Search className="size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-ui text-ink-muted">Search</span>

        {/* The key that opens the same box, said where it opens (note
            3fbdac0b). A hint like every other one: invisible until ⌘ or ⌥ is
            held (note 935820d9). */}
        <Kbd className="shrink-0">⌘K</Kbd>
      </button>
    </div>
  );
}
