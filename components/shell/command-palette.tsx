'use client';

import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { popoverSurface, scrim } from '@/components/ui/popover';
import { Kbd } from '@/components/shell/key-hints';
import { SearchRowLine } from '@/components/shell/search-row';
import {
  searchRowKey,
  useSearchRows,
  type SearchRow,
} from '@/components/shell/use-search-rows';
import { scopeForModule } from '@/lib/search/scope';
import type { ModuleId } from '@/lib/modules';
import type { Theme } from '@/lib/theme';
import type { NavSection } from '@/components/shell/app-shell';

/**
 * Go anywhere, from anywhere.
 *
 * In a four-workspace app the most repeated action is "get me to the other
 * thing", and it otherwise costs a click into the switcher, a read, and a
 * second click. This is one keystroke and a few letters.
 *
 * What goes in the list, where it comes from and in what order is
 * components/shell/use-search-rows.ts, because the bar across the top of the
 * workspace shows the same rows, and how one of them is drawn is
 * components/shell/search-row.tsx for the same reason. This file is the modal:
 * the scrim, the field and the keys that walk the list.
 *
 * It searches the workspace the page is in, and everything you own on a page
 * that is in no workspace. So it opens on that workspace's pages and what you
 * can start there, and nothing from anywhere else; outside a workspace it
 * opens on the list it has always opened on.
 */
export function CommandPalette({
  account,
  module,
  sections,
  enabledModules,
  theme,
}: {
  /** Whose pages these are. The held list is only searched when it is theirs. */
  account: string;
  module: ModuleId | null;
  sections: readonly NavSection[];
  enabledModules?: readonly ModuleId[];
  /** What is on screen now, so a colour can be applied to the mode you are in. */
  theme: Theme;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { rows, looking, run, reset } = useSearchRows({
    account,
    module,
    // The workspace the page is in, or everything where there is no workspace
    // to narrow to. It follows the page rather than being held here, so the
    // box opened after a navigation searches where you now are. The chip that
    // widens it to everything is #703, and that is what turns this into
    // state.
    scope: scopeForModule(module),
    sections,
    enabledModules,
    theme,
    query,
    active: open,
    // So an open box with nothing typed in it lists this workspace's pages
    // and what you can start here.
    surface: 'box',
  });

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    setQuery('');
    setActive(0);
    reset();
  }

  function choose(row: SearchRow | undefined) {
    if (!row) return;
    close();
    run(row);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-modal flex items-start justify-center px-4 pt-[12vh]">
      <button
        type="button"
        aria-label="Close"
        onClick={close}
        className={scrim}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        // The same floating surface as every panel in the shell, lifted
        // further: this one is over a scrim at a twelfth of the way down the
        // window rather than hanging off a button, and a shallow drop there
        // reads as a card that has come loose rather than as a thing in front.
        className={cn(popoverSurface, 'relative w-full max-w-lg overflow-hidden shadow-2xl')}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                close();
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((index) => (index + 1) % Math.max(rows.length, 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((index) => (index - 1 + rows.length) % Math.max(rows.length, 1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                choose(rows[active]);
              }
            }}
            placeholder="Go anywhere, or find anything…"
            aria-label="Command"
            // No focus ring: the palette focuses this field on open, so the
            // global ring was drawn around the search bar permanently rather
            // than ever indicating anything. See globals.css.
            data-focus-ring="none"
            className="h-12 w-full bg-transparent text-body text-ink outline-none placeholder:text-ink-ghost"
          />
          {/* The shell's keycap, not a second drawing of one: this was a
              hairline bigger and a step up the type scale from every other
              cap in the app, which is visible the moment the palette opens
              over a row of them. `always`, because inside an open palette
              there is no modifier being held. */}
          <Kbd always>esc</Kbd>
        </div>

        <div ref={listRef} className="max-h-80 overflow-y-auto p-1">
          {rows.length === 0 ? (
            <p className="px-3 py-6 text-center text-ui text-ink-muted">
              {/* Only once looking has finished. "Nothing matches" while a
                  request is still out is a lie that corrects itself, which is
                  the most annoying kind. */}
              {looking ? 'Looking…' : `Nothing matches “${query}”.`}
            </p>
          ) : (
            rows.map((row, index) => (
              <SearchRowLine
                key={searchRowKey(row)}
                row={row}
                active={index === active}
                onChoose={() => choose(row)}
                onPoint={() => setActive(index)}
              />
            ))
          )}

          {/* Quiet, and below the rows rather than in place of them, so
              nothing already on screen moves while a newer answer lands. */}
          {looking && rows.length > 0 && (
            <p className="px-3 py-1.5 text-small text-ink-ghost">Looking…</p>
          )}
        </div>
      </div>
    </div>
  );
}
