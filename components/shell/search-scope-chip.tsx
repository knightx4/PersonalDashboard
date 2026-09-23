'use client';

import { useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ModuleMark } from '@/components/ui/module-mark';
import { Popover } from '@/components/ui/popover';
import { usePopover } from '@/lib/use-popover';
import { scopeForModule, scopeLabel, type SearchScope } from '@/lib/search/scope';
import type { ModuleId } from '@/lib/modules';

/**
 * The chip at the right end of a search field, naming what is being searched.
 *
 * Two states and no more, which is lib/search/scope.ts: the workspace the page
 * is in, or everything you own. The chip was a switch between them -- press it
 * and the word changed -- and a switch is the wrong control for this. Nothing
 * on it said there was a second state, so the only way to find the other one
 * was to press it and read what happened; pressing it a second time to go back
 * looked like a control that did nothing at all, which is how note ca910aa3
 * described it. So it is a menu: it says what it is searching, it opens
 * downward on a press, and both scopes are on screen with a tick against the
 * one you are in. Picking the one already on is a no-op rather than a switch
 * back.
 *
 * Outside a workspace there is nothing to narrow to, so there is no chip. The
 * caller does not have to test for that -- both surfaces pass whatever
 * `module` the shell gave them and get nothing back on Home and the account
 * page.
 *
 * One component because the bar and the box draw the same chip. It started in
 * components/shell/search-bar.tsx and moved here when the box got one too
 * (#703), the same way SearchRowLine moved into components/shell/search-row.tsx
 * when both surfaces drew the same row.
 */
export function SearchScopeChip({
  scope,
  module,
  onScope,
  onOpenChange,
}: {
  /** What is being searched now. */
  scope: SearchScope;
  /** The workspace the page is in, which is the narrow state. */
  module: ModuleId | null;
  /** What to search instead. Given the scope that was picked, on already or not. */
  onScope: (next: SearchScope) => void;
  /**
   * Whether the menu is up.
   *
   * For a caller that hangs its own panel under the same field: the bar's list
   * of rows is a floating panel drawn after this one, so with both open the
   * list paints over the menu. The bar stands its list down while a scope is
   * being picked rather than either of them reaching for a higher layer.
   */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  function show(next: boolean) {
    setOpen(next);
    onOpenChange?.(next);
  }

  usePopover({ open, onClose: () => show(false), panelRef, triggerRef });

  if (module === null) return null;

  /** The workspace first, because it is where the page stands and the narrower answer. */
  const choices: SearchScope[] = [scopeForModule(module), 'everything'];

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? panelId : undefined}
        onClick={() => show(!open)}
        // Named by what it is searching and by what pressing it does. The word
        // on it is a state, and what the press does now is offer the choice
        // rather than make it.
        aria-label={`Searching ${scopeLabel(scope)}. Choose what to search`}
        // The mark alone on the chip, and the name on hover and in the menu
        // (note 0679c2fa): the word took a third of a field that is only so
        // wide, and every workspace's mark is already its name at a glance.
        title={`Searching ${scopeLabel(scope)}`}
        // ui-ok: hand-rolled-box -- the pill is the button, so its edge is the
        // control rather than a frame around a group. It stands on the field's
        // own ground, so neither a shared ground nor space can say that it is
        // something you press. No primitive draws this shape: Button is
        // rounded-control and its smallest size is the height of the box this
        // sits inside, and ChipSelect and ChipInput wrap a select and an input.
        // The edge is drawn only on hover, focus and while the menu is open:
        // at rest the mark and the chevron already say what it is,
        // and a ring inside the field's own ring read as a second box.
        className="press flex shrink-0 items-center gap-1.5 rounded-full border border-transparent py-0 pl-0.5 pr-1.5 text-small text-ink-muted transition-colors hover:border-border hover:bg-sunken hover:text-ink focus-visible:border-border aria-expanded:border-border aria-expanded:bg-sunken"
      >
        {/* The mark of what is being searched: a workspace's own, or the app's
            for everything you own. */}
        <ModuleMark module={scope === 'everything' ? null : scope} size="sm" />
        {/* Which way the choice opens, and that there is one. */}
        <ChevronDown className="size-3 shrink-0" strokeWidth={2} aria-hidden />
      </button>

      {open && (
        <Popover
          ref={panelRef}
          id={panelId}
          // Hung from the chip's right edge: the chip is at the right end of
          // the field, and a panel wider than it hangs off the page from the
          // other one.
          anchor="trigger-below-end"
          padding="menu"
          role="menu"
          tabIndex={-1}
          aria-label="What to search"
          className="w-44"
        >
          {choices.map((choice) => (
            <button
              key={choice}
              type="button"
              role="menuitemradio"
              aria-checked={choice === scope}
              onClick={() => {
                onScope(choice);
                show(false);
              }}
              className={cn(
                'press flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-ui transition-colors duration-150 hover:bg-sunken',
                choice === scope ? 'text-ink' : 'text-ink-muted',
              )}
            >
              <ModuleMark module={choice === 'everything' ? null : choice} size="sm" />
              <span className="min-w-0 flex-1 truncate text-left">{scopeLabel(choice)}</span>
              {/* The tick rather than a highlighted row: the one you are in is
                  a state, and the row under the pointer is already lit. */}
              {choice === scope && (
                <Check className="size-3.5 shrink-0 text-ink-muted" strokeWidth={2} aria-hidden />
              )}
            </button>
          ))}
        </Popover>
      )}
    </div>
  );
}
