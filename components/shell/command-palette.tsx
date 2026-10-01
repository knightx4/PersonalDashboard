'use client';

import { useEffect, useRef, useState } from 'react';
import { SearchMark } from '@/components/ui/search-mark';
import { cn } from '@/lib/cn';
import { popoverSurface, scrim } from '@/components/ui/popover';
import { Kbd } from '@/components/shell/key-hints';
import { SearchRowLine } from '@/components/shell/search-row';
import { SearchScopeChip } from '@/components/shell/search-scope-chip';
import {
  searchRowKey,
  useSearchRows,
  type SearchRow,
} from '@/components/shell/use-search-rows';
import { scopeForModule, type SearchScope } from '@/lib/search/scope';
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
 * components/shell/use-search-rows.ts, and how one of them is drawn is
 * components/shell/search-row.tsx. This file is the modal:
 * the scrim, the field and the keys that walk the list.
 *
 * Every opening starts on everything you own (plan #1363), except one: picking
 * the workspace from the chip on the top bar's field opens the box already
 * narrowed there (plan #1364), which is `opensOn`. The chip beside this field
 * offers the same two scopes -- this workspace and everything you own -- and
 * narrowing lasts until the box closes; the next opening starts on whatever
 * the way in asks for, which is everything unless it was that chip.
 *
 * This is the whole of search at every width: the field in the top bar opens
 * it from lg up, the magnifier opens it below lg, and ⌘K opens it at any
 * width. Whether it is open is the shell's, not this file's, because the
 * shell holds all three ways in.
 */
export function CommandPalette({
  account,
  module,
  sections,
  enabledModules,
  theme,
  open,
  opensOn = 'everything',
  onOpenChange,
}: {
  /** Whose pages these are. The held list is only searched when it is theirs. */
  account: string;
  module: ModuleId | null;
  sections: readonly NavSection[];
  enabledModules?: readonly ModuleId[];
  /** What is on screen now, so a colour can be applied to the mode you are in. */
  theme: Theme;
  /** Whether the box is up. Held by the shell, which holds every way in. */
  open: boolean;
  /**
   * What the box searches when it opens. Everything, unless it was opened
   * from the bar's chip with the workspace picked. Read on each opening only,
   * so a narrowed box does not stay narrowed for the next one.
   */
  opensOn?: SearchScope;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  /**
   * What is being searched, which starts as `opensOn`.
   *
   * State rather than derived, because the chip narrows it. It does not
   * survive the box closing: every opening starts on what that opening asked
   * for (plans #1363 and #1364).
   */
  const [scope, setScope] = useState<SearchScope>(opensOn);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Every opening starts on what it asked for. Adjusted while rendering the
  // opening rather than in an effect, so the first frame of the box already
  // says so.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setScope(opensOn);
      setActive(0);
    }
  }

  const { rows, looking, run, reset } = useSearchRows({
    account,
    module,
    scope,
    sections,
    enabledModules,
    theme,
    query,
    active: open,
  });

  /**
   * A narrowed box follows the page.
   *
   * The shell holds the box across a navigation, so a scope left pointing at
   * the workspace you have just left would search somewhere you are not.
   * Arriving anywhere new while it is narrowed narrows it to the workspace you
   * have landed in, or widens it where there is no workspace.
   */
  const standingIn = useRef(module);
  useEffect(() => {
    if (standingIn.current === module) return;
    standingIn.current = module;
    setScope((current) => (current === 'everything' ? current : scopeForModule(module)));
    setActive(0);
  }, [module]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  function close() {
    onOpenChange(false);
    setQuery('');
    setActive(0);
    reset();
  }

  function choose(row: SearchRow | undefined) {
    if (!row) return;
    close();
    run(row);
  }

  function chooseScope(next: SearchScope) {
    setScope(next);
    setActive(0);
    reset();
    // The cursor goes back where it was: switching what is being searched is
    // something you do in the middle of typing, not instead of typing.
    inputRef.current?.focus();
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
          <SearchMark className="text-ink-muted" />
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
          {/* The chip naming what is being searched, in two states. It sits
              between the field and the keycap because it belongs to the field
              -- what is being searched -- rather than to the box. */}
          <SearchScopeChip scope={scope} module={module} onScope={chooseScope} />
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
