/**
 * What counts as selected, in one place.
 *
 * Every list that gains multi-select needs the same five answers: tick one
 * row, extend a range from the last row touched, take everything, drop the
 * lot, and forget rows the server no longer lists. They are pure functions
 * here so a row, a keyboard handler and an action bar cannot disagree about
 * any of them, and so each rule is pinned by a test rather than by whichever
 * list was written first.
 *
 * The set holds ids rather than row keys, because a row can stand for more
 * than one thing: the inventory list draws one row for three copies of a book,
 * and "mark for sale" said to that row means all three. A row is selected when
 * every id it stands for is.
 *
 * Order comes in as an argument. Nothing here remembers a list, which is what
 * makes a range possible at all — "everything between the anchor and this row"
 * is a question about the order on screen, not about the set.
 */

/** One row of a list, in the order the list draws it. */
export type SelectionRow = {
  /** Identifies the row: what the anchor and the focus point at. */
  key: string;
  /** Everything the row stands for. Defaults to the key on its own. */
  ids?: readonly string[];
};

export type SelectionState = {
  selected: ReadonlySet<string>;
  /** The row a range extends from: the last one ticked directly. */
  anchor: string | null;
};

export const EMPTY_SELECTION: SelectionState = {
  selected: new Set<string>(),
  anchor: null,
};

/** The ids a row stands for. */
export function rowIds(row: SelectionRow): readonly string[] {
  return row.ids && row.ids.length > 0 ? row.ids : [row.key];
}

/** True only when every id the row stands for is in the set. */
export function isRowSelected(state: SelectionState, row: SelectionRow): boolean {
  return rowIds(row).every((id) => state.selected.has(id));
}

function findRow(
  rows: readonly SelectionRow[],
  key: string,
): SelectionRow | undefined {
  return rows.find((row) => row.key === key);
}

/**
 * Tick or untick one row, and put the anchor on it.
 *
 * A row that is only partly selected — some of its copies deleted and
 * re-added, say — ticks the rest rather than clearing what is there, so a row
 * is never left half in the set.
 */
export function toggleRow(
  state: SelectionState,
  rows: readonly SelectionRow[],
  key: string,
): SelectionState {
  const row = findRow(rows, key);
  if (!row) return state;

  const ids = rowIds(row);
  const next = new Set(state.selected);
  if (isRowSelected(state, row)) {
    for (const id of ids) next.delete(id);
  } else {
    for (const id of ids) next.add(id);
  }
  return { selected: next, anchor: key };
}

/**
 * Add everything from the anchor to this row, inclusive, in list order.
 *
 * The anchor stays where it was, so a second shift-click extends from the same
 * place rather than from the row it just reached. A range only ever adds: what
 * was already selected outside it stays selected. With no anchor yet the range
 * is the one row, which then becomes the anchor.
 */
export function extendRange(
  state: SelectionState,
  rows: readonly SelectionRow[],
  key: string,
): SelectionState {
  const to = rows.findIndex((row) => row.key === key);
  if (to < 0) return state;

  const from =
    state.anchor === null
      ? -1
      : rows.findIndex((row) => row.key === state.anchor);
  const start = from < 0 ? to : Math.min(from, to);
  const end = from < 0 ? to : Math.max(from, to);

  const next = new Set(state.selected);
  for (const row of rows.slice(start, end + 1)) {
    for (const id of rowIds(row)) next.add(id);
  }
  return { selected: next, anchor: from < 0 ? key : state.anchor };
}

/** Every row on the list. No row was touched, so there is no anchor. */
export function selectAllRows(rows: readonly SelectionRow[]): SelectionState {
  const next = new Set<string>();
  for (const row of rows) {
    for (const id of rowIds(row)) next.add(id);
  }
  return { selected: next, anchor: null };
}

export function clearSelection(): SelectionState {
  return EMPTY_SELECTION;
}

/**
 * Drop ids the list no longer holds, and the anchor if its row has gone.
 *
 * Rows come back from the server on every write, so a selection outlives the
 * things in it — confirm four orders and the four rows leave the queue while
 * their ids sit in the set. Returns the state it was given when there is
 * nothing to drop, so a provider can prune on every render without setting
 * state it did not change.
 */
export function pruneSelection(
  state: SelectionState,
  rows: readonly SelectionRow[],
): SelectionState {
  const present = new Set<string>();
  for (const row of rows) {
    for (const id of rowIds(row)) present.add(id);
  }

  const dropped = [...state.selected].some((id) => !present.has(id));
  const anchorGone =
    state.anchor !== null && !rows.some((row) => row.key === state.anchor);
  if (!dropped && !anchorGone) return state;

  return {
    selected: new Set([...state.selected].filter((id) => present.has(id))),
    anchor: anchorGone ? null : state.anchor,
  };
}

/** The selected rows, in the order the list draws them. */
export function selectedRows(
  state: SelectionState,
  rows: readonly SelectionRow[],
): SelectionRow[] {
  return rows.filter((row) => isRowSelected(state, row));
}

/** What a bulk action is run against: every id of every selected row. */
export function selectedIds(
  state: SelectionState,
  rows: readonly SelectionRow[],
): string[] {
  return selectedRows(state, rows).flatMap((row) => [...rowIds(row)]);
}
