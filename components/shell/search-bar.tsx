'use client';

import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { popoverSurface } from '@/components/ui/popover';
import { SearchRowLine } from '@/components/shell/search-row';
import { SearchScopeChip } from '@/components/shell/search-scope-chip';
import {
  searchRowKey,
  useSearchRows,
  type SearchRow,
} from '@/components/shell/use-search-rows';
import { scopeForModule, toggleScope, type SearchScope } from '@/lib/search/scope';
import type { ModuleId } from '@/lib/modules';
import type { Theme } from '@/lib/theme';
import type { NavSection } from '@/components/shell/app-shell';

/**
 * The search bar, with the chip that says what it is searching.
 *
 * A field you can type in without opening anything first, and a chip at its
 * right end naming the workspace the search is narrowed to. The field is
 * empty and so is the space under it: the list arrives with the first
 * character and not before, because a bar that is always on screen would
 * otherwise drop a panel over the page every time somebody tabbed past it. Pressing the chip
 * widens it to everything you own and pressing it again narrows it back, and
 * the list under the field changes with it: narrowed, it offers this
 * workspace's things, its pages and what you can start in it; widened, it is
 * the whole list the command box has always shown.
 *
 * What goes in the list, in what order and with what caps is
 * components/shell/use-search-rows.ts, the same hook the modal draws from, and
 * narrowing is lib/search/scope.ts. This file is the control: the field, the
 * chip, the keys that walk the list, and where the list hangs.
 *
 * Nothing is fetched until the field has the cursor. The hook takes `active`
 * for exactly that, so a page carrying this bar costs no request until
 * somebody means to search.
 */
export function SearchBar({
  account,
  module,
  sections,
  enabledModules,
  theme,
  className,
}: {
  /** Whose pages these are. The held list is only searched when it is theirs. */
  account: string;
  /**
   * The workspace the page is in. It is both what the navigation half is built
   * from and what the chip narrows to.
   */
  module: ModuleId | null;
  sections: readonly NavSection[];
  enabledModules?: readonly ModuleId[];
  /** What is on screen now, so a colour can be applied to the mode you are in. */
  theme: Theme;
  /** The width the bar is given, which is the top bar's business rather than this file's. */
  className?: string;
}) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SearchScope>(() => scopeForModule(module));
  const [active, setActive] = useState(0);
  /** The field has the cursor. This is what starts the fetch and shows the list. */
  const [focused, setFocused] = useState(false);
  /** Escape was pressed: the list is shut while the text stays where it is. */
  const [dismissed, setDismissed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { rows, looking, run, reset } = useSearchRows({
    account,
    module,
    scope,
    sections,
    enabledModules,
    theme,
    query,
    active: focused,
    // Which decides what an empty field offers, and the bar offers nothing.
    // The fetch still goes out on focus, so the first character has rows to
    // match against.
    surface: 'bar',
  });

  /**
   * The chip follows the page.
   *
   * The bar sits in the top bar of every workspace and survives a navigation,
   * so a chip left pointing at the workspace you have just left would be
   * naming somewhere you are not. Going anywhere new puts it back to the
   * workspace you have landed in, which is the bar's resting state.
   */
  const standingIn = useRef(module);
  useEffect(() => {
    if (standingIn.current === module) return;
    standingIn.current = module;
    setScope(scopeForModule(module));
    setActive(0);
  }, [module]);

  /**
   * When there is a list under the field at all.
   *
   * An empty field has nothing to show, so the panel is not drawn rather than
   * drawn around no rows: the empty state reads "Nothing matches" and naming
   * the empty string is worse than showing nothing. Clicking in, tabbing in
   * and arriving from the keyboard all land here, so all three leave the page
   * as it was until a character is typed.
   */
  const showing = focused && !dismissed && query.trim() !== '';

  function choose(row: SearchRow | undefined) {
    if (!row) return;
    // The field empties on the way out: you have arrived at the thing you were
    // looking for, and the bar stays on screen afterwards, so the words that
    // found it would otherwise sit in the top bar of wherever you landed.
    setQuery('');
    setActive(0);
    setDismissed(false);
    reset();
    // Shut by hand rather than by blurring the field: a row chosen with the
    // mouse is chosen with the *row* focused, so there is nothing on the field
    // to blur and the list would stay open over the page you just opened.
    setFocused(false);
    inputRef.current?.blur();
    run(row);
  }

  function pressChip() {
    setScope((current) => toggleScope(current, module));
    setActive(0);
    setDismissed(false);
    reset();
    // The cursor goes back where it was: switching what is being searched is
    // something you do in the middle of typing, not instead of typing.
    inputRef.current?.focus();
  }

  return (
    <div
      className={cn('relative', className)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        // The chip and every row in the list are inside this box, so pressing
        // one of them is not leaving the bar -- without this the list would
        // unmount under the pointer on its way to being clicked.
        if (event.currentTarget.contains(event.relatedTarget)) return;
        setFocused(false);
        setDismissed(false);
        reset();
      }}
    >
      {/* ui-ok: hand-rolled-box -- a control's own edge rather than a frame
        * around a group. `border-control` is the 3:1 token an input owes under
        * WCAG 1.4.11, and here it is the only thing saying where you can type.
        * Card and Group are content surfaces. Card has the card radius and no
        * border, Group draws nothing at all, and neither has a focus state.
        *
        * Drawn here rather than taken from Input because a control sits inside
        * the field, so the border has to belong to the pair. The tokens are
        * the shared control's, and the ring is focus-within so the box lights
        * up while the chip has the cursor. */}
      <div className="flex h-(--control-h) items-center gap-2 rounded-control border border-control bg-surface px-(--control-px) focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/40">
        <Search className="size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            // Typing after Escape is asking again, so the list comes back.
            setDismissed(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              // The list goes and the text stays. Escape in a bar that is
              // always on screen means "not that list", not "forget it" --
              // clearing the field as well would make the one key that
              // dismisses a list also the one that destroys what you typed.
              setDismissed(true);
              setActive(0);
              reset();
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              // After Escape the arrows bring the list back rather than
              // walking one nobody can see.
              if (dismissed) setDismissed(false);
              else setActive((index) => (index + 1) % Math.max(rows.length, 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              if (dismissed) setDismissed(false);
              else setActive((index) => (index - 1 + rows.length) % Math.max(rows.length, 1));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              if (dismissed) setDismissed(false);
              else choose(rows[active]);
            }
          }}
          placeholder="Search"
          aria-label="Search"
          // No focus ring on the field itself: the box around the field and
          // the chip carries it, and two rings on one control is a thickening
          // rather than an indication. See globals.css.
          data-focus-ring="none"
          // eslint-disable-next-line no-restricted-syntax -- text-base is the one deliberate off-scale size: 16px stops iOS zooming on focus.
          className="h-full w-full min-w-0 bg-transparent text-base text-ink outline-none placeholder:text-ink-ghost sm:text-ui"
        />

        <SearchScopeChip scope={scope} module={module} onPress={pressChip} />
      </div>

      {showing && (
        <div
          className={cn(
            popoverSurface,
            'absolute inset-x-0 top-full z-overlay mt-1.5 max-h-80 overflow-y-auto p-1',
          )}
        >
          {rows.length === 0 ? (
            <p className="px-3 py-6 text-center text-ui text-ink-muted">
              {/* Only once looking has finished. "Nothing matches" while a
                  request is still out is a lie that corrects itself. */}
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

          {/* Below the rows rather than in place of them, so nothing already
              on screen moves while a newer answer lands. */}
          {looking && rows.length > 0 && (
            <p className="px-3 py-1.5 text-small text-ink-ghost">Looking…</p>
          )}
        </div>
      )}
    </div>
  );
}
