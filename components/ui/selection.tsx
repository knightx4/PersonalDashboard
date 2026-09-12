'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/shell/key-hints';
import {
  EMPTY_SELECTION,
  clearSelection,
  clickRule,
  extendRange,
  isRowSelected,
  keyRule,
  nextFocus,
  pruneSelection,
  selectAllRows,
  selectedIds,
  toggleRow,
  type SelectionRow,
  type SelectionState,
} from '@/lib/selection/model';

/**
 * Selection over a list, held above the rows.
 *
 * A row can say "tick me" and an action bar can ask "what is ticked", and
 * neither needs to know about the other. The rules themselves are in
 * lib/selection/model.ts; this holds the set, the anchor a shift-click extends
 * from, and which row the keyboard is on, and hands the list's own order to
 * every rule that needs it.
 *
 * The list passes its rows in on every render, so the selection survives a
 * server round trip but not the rows leaving: confirm four orders and their
 * ids are dropped as the shorter list comes back, without the bar having to
 * reach in and tidy up.
 */
export type Selection = {
  /** The ids selected right now, across every row. */
  selected: ReadonlySet<string>;
  /** Where a shift-click extends from: the last row ticked directly. */
  anchor: string | null;
  /** The row the keyboard is on, or null when the list has not been touched. */
  focused: string | null;
  /** Selected rows, not ids: what "3 selected" counts. */
  count: number;
  /** Every id of every selected row, in list order. What an action gets. */
  ids: readonly string[];
  isSelected: (key: string) => boolean;
  /** True for the one row the keyboard is on. */
  isFocused: (key: string) => boolean;
  toggle: (key: string) => void;
  extendTo: (key: string) => void;
  selectAll: () => void;
  clear: () => void;
  focus: (key: string | null) => void;
  /** Move the highlight one row, stopping at either end of the list. */
  moveFocus: (direction: 'down' | 'up') => void;
};

const SelectionContext = createContext<Selection | null>(null);

/**
 * Null outside a provider, so a row component renders on a page that has no
 * selection at all rather than throwing.
 */
export function useSelection(): Selection | null {
  return useContext(SelectionContext);
}

export function SelectionProvider({
  rows,
  children,
}: {
  /** The list as drawn, in order. A range is a question about this. */
  rows: readonly SelectionRow[];
  children: ReactNode;
}) {
  const [stored, setStored] = useState<SelectionState>(EMPTY_SELECTION);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  // Pruned on the way out rather than in an effect: a row that has left the
  // list stops counting on the render it leaves, with no second pass.
  const state = useMemo(() => pruneSelection(stored, rows), [stored, rows]);
  const focused = useMemo(
    () => (focusedKey !== null && rows.some((row) => row.key === focusedKey) ? focusedKey : null),
    [focusedKey, rows],
  );

  const toggle = useCallback(
    (key: string) => setStored((current) => toggleRow(pruneSelection(current, rows), rows, key)),
    [rows],
  );

  const extendTo = useCallback(
    (key: string) => setStored((current) => extendRange(pruneSelection(current, rows), rows, key)),
    [rows],
  );

  const selectAll = useCallback(() => setStored(selectAllRows(rows)), [rows]);

  const clear = useCallback(() => setStored(clearSelection()), []);

  const moveFocus = useCallback(
    (direction: 'down' | 'up') => setFocusedKey((current) => nextFocus(rows, current, direction)),
    [rows],
  );

  // One listener for the whole list, on the provider rather than on the rows:
  // a row only has the keyboard when it is focused, and the keys have to work
  // while the focus is nowhere in particular. What each press means is
  // keyRule's, so the listener only has to do what it says.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const hasSelection = state.selected.size > 0;
      const action = keyRule(
        {
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          target: target
            ? { tagName: target.tagName, isContentEditable: target.isContentEditable === true }
            : null,
        },
        hasSelection,
      );
      if (!action) return;

      event.preventDefault();
      if (action === 'down' || action === 'up') {
        setFocusedKey((current) => nextFocus(rows, current, action));
        return;
      }
      if (action === 'toggle') {
        if (focused === null) return;
        setStored((current) => toggleRow(pruneSelection(current, rows), rows, focused));
        return;
      }
      // Only reached while something is selected, so nothing else on the page
      // gets to read this Esc as "back out one level" as well.
      event.stopPropagation();
      setStored(clearSelection());
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [rows, focused, state.selected]);

  const value = useMemo<Selection>(() => {
    const ids = selectedIds(state, rows);
    const byKey = new Map(rows.map((row) => [row.key, row]));
    return {
      selected: state.selected,
      anchor: state.anchor,
      focused,
      count: rows.filter((row) => isRowSelected(state, row)).length,
      ids,
      isSelected: (key: string) => {
        const row = byKey.get(key);
        return row ? isRowSelected(state, row) : false;
      },
      isFocused: (key: string) => focused === key,
      toggle,
      extendTo,
      selectAll,
      clear,
      focus: setFocusedKey,
      moveFocus,
    };
  }, [state, rows, focused, toggle, extendTo, selectAll, clear, moveFocus]);

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

/**
 * The class a row carries so its tick box can see the hover.
 *
 * The box is hidden until the pointer is somewhere on the row, not just on the
 * box itself — a checkbox you have to find before you can hover it is worse
 * than a column of them. Tailwind names that relationship with a group, so the
 * row element and the box have to agree on the name; this is the name.
 */
export const selectionRowClass = 'group/select';

/** The ring on the row the keyboard is on, matching the review queues' cursor. */
export const selectionFocusClass = 'border-accent ring-2 ring-accent/15';

/**
 * The classes a row's own element needs: the group name, plus the ring while
 * the keyboard is on it. A list calls this instead of reading `isFocused` and
 * picking a ring of its own, so j and k look the same in every list.
 */
export function useSelectionRowClass(rowKey: string, className?: string): string {
  const selection = useSelection();
  return cn(selectionRowClass, selection?.isFocused(rowKey) && selectionFocusClass, className);
}

/**
 * The page header while rows are selected: how many, what can be done to them,
 * and Clear.
 *
 * Rendered through PageHeader's `bulk` slot, into the same grid cell as the
 * heading, which is why it carries the cell's position and the attribute the
 * header hides itself by. Nothing at all is drawn while nothing is selected,
 * so a page can pass this unconditionally.
 *
 * The verbs are the page's, because only the page knows what its rows take and
 * how many of the selection each one covers. The count and Clear are the
 * same everywhere, so they are here.
 */
export function SelectionActionBar({ children }: { children?: ReactNode }) {
  const selection = useSelection();
  if (!selection || selection.count === 0) return null;

  return (
    <div
      data-selection-bar
      role="toolbar"
      aria-label="Actions for the selected rows"
      className="col-start-1 row-start-1 flex flex-wrap items-center gap-2"
    >
      <span className="font-display text-title tracking-tight text-ink">
        {selection.count} selected
      </span>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        {children}
        <Button type="button" variant="ghost" size="sm" onClick={selection.clear}>
          Clear
          <Kbd>Esc</Kbd>
        </Button>
      </div>
    </div>
  );
}

/**
 * A row's tick box, drawn at its left edge and invisible until it is wanted.
 *
 * A permanently visible checkbox column taxes every ordinary read of the list,
 * so the box only appears when the row is hovered, when it is focused, or when
 * it is already selected. Under a coarse pointer there is no hover to wait
 * for, so it is always there. Nothing shifts when it appears: it is opacity,
 * not display, and the space is held either way.
 */
export function SelectionCheckbox({
  rowKey,
  label,
  className,
}: {
  /** The row this box ticks: the same key the provider was given. */
  rowKey: string;
  /** What the row is, for the screen reader: "Select <label>". */
  label: string;
  className?: string;
}) {
  const selection = useSelection();
  if (!selection) return null;

  const checked = selection.isSelected(rowKey);
  const focused = selection.isFocused(rowKey);

  const click = (event: MouseEvent<HTMLInputElement>) => {
    // The box draws what the provider holds, so the browser's own toggle would
    // only be undone on the next render. Pressing space fires a click too,
    // with no modifiers, which is why there is no onChange beside this.
    event.preventDefault();
    if (clickRule(event.nativeEvent) === 'range') selection.extendTo(rowKey);
    else selection.toggle(rowKey);
  };

  return (
    <label className={cn('relative flex shrink-0 cursor-pointer items-center', className)}>
      <input
        type="checkbox"
        checked={checked}
        readOnly
        aria-label={`Select ${label}`}
        onClick={click}
        // Shift-clicking anything in a document selects the text between it and
        // the last click, which on a list of rows is the whole list going blue.
        onMouseDown={(event) => {
          if (event.shiftKey) event.preventDefault();
        }}
        className={cn(
          'size-4 rounded border-border text-accent focus:ring-accent/30',
          'transition-opacity duration-150 focus-visible:opacity-100',
          'group-hover/select:opacity-100 group-focus-within/select:opacity-100',
          'pointer-coarse:opacity-100',
          // The highlight is not DOM focus, so group-focus-within does not see
          // it: a row reached with j or k shows its box the same way a hovered
          // one does.
          checked || focused ? 'opacity-100' : 'opacity-0',
        )}
      />
      {/*
       * The two keys that work on this row, on the row they work on, and only
       * while ⌘ is held. Absolute so they overlay the start of the row rather
       * than widening it: a keycap that holds its space would move every row's
       * text as the highlight passed. Esc appears only when there is a
       * selection for it to clear, which is exactly when it does anything.
       */}
      {focused && (
        <span className="pointer-events-none absolute left-full top-1/2 ml-1 flex -translate-y-1/2 items-center gap-0.5 rounded bg-surface/90">
          <Kbd>x</Kbd>
          {selection.count > 0 && <Kbd>Esc</Kbd>}
        </span>
      )}
    </label>
  );
}
