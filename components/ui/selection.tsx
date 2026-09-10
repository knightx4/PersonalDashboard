'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';
import {
  EMPTY_SELECTION,
  clearSelection,
  clickRule,
  extendRange,
  isRowSelected,
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
  toggle: (key: string) => void;
  extendTo: (key: string) => void;
  selectAll: () => void;
  clear: () => void;
  focus: (key: string | null) => void;
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
    (key: string) =>
      setStored((current) => toggleRow(pruneSelection(current, rows), rows, key)),
    [rows],
  );

  const extendTo = useCallback(
    (key: string) =>
      setStored((current) => extendRange(pruneSelection(current, rows), rows, key)),
    [rows],
  );

  const selectAll = useCallback(() => setStored(selectAllRows(rows)), [rows]);

  const clear = useCallback(() => setStored(clearSelection()), []);

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
      toggle,
      extendTo,
      selectAll,
      clear,
      focus: setFocusedKey,
    };
  }, [state, rows, focused, toggle, extendTo, selectAll, clear]);

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

  const click = (event: MouseEvent<HTMLInputElement>) => {
    // The box draws what the provider holds, so the browser's own toggle would
    // only be undone on the next render. Pressing space fires a click too,
    // with no modifiers, which is why there is no onChange beside this.
    event.preventDefault();
    if (clickRule(event.nativeEvent) === 'range') selection.extendTo(rowKey);
    else selection.toggle(rowKey);
  };

  return (
    <label className={cn('flex shrink-0 cursor-pointer items-center', className)}>
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
          checked ? 'opacity-100' : 'opacity-0',
        )}
      />
    </label>
  );
}
