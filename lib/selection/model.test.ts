import { describe, expect, it } from 'vitest';
import {
  EMPTY_SELECTION,
  clearSelection,
  extendRange,
  isRowSelected,
  pruneSelection,
  rowIds,
  selectAllRows,
  selectedIds,
  selectedRows,
  toggleRow,
  type SelectionRow,
  type SelectionState,
} from './model';

/** Four plain rows, plus one standing for three copies of the same book. */
const rows: SelectionRow[] = [
  { key: 'a' },
  { key: 'b' },
  { key: 'c', ids: ['c1', 'c2', 'c3'] },
  { key: 'd' },
];

const state = (selected: string[], anchor: string | null = null): SelectionState => ({
  selected: new Set(selected),
  anchor,
});

const ids = (result: SelectionState) => [...result.selected].sort();

describe('rowIds', () => {
  it('is the key alone when a row stands for one thing', () => {
    expect(rowIds({ key: 'a' })).toEqual(['a']);
  });

  it('is every copy when a row stands for several', () => {
    expect(rowIds({ key: 'c', ids: ['c1', 'c2', 'c3'] })).toEqual(['c1', 'c2', 'c3']);
  });

  it('falls back to the key when the id list is empty', () => {
    expect(rowIds({ key: 'a', ids: [] })).toEqual(['a']);
  });
});

describe('isRowSelected', () => {
  it('needs every copy, not just one', () => {
    expect(isRowSelected(state(['c1']), rows[2])).toBe(false);
    expect(isRowSelected(state(['c1', 'c2', 'c3']), rows[2])).toBe(true);
  });
});

describe('toggleRow', () => {
  it('adds a row and anchors on it', () => {
    const result = toggleRow(EMPTY_SELECTION, rows, 'b');
    expect(ids(result)).toEqual(['b']);
    expect(result.anchor).toBe('b');
  });

  it('removes a row that was selected', () => {
    const result = toggleRow(state(['a', 'b']), rows, 'a');
    expect(ids(result)).toEqual(['b']);
  });

  it('takes all of a row’s copies at once', () => {
    const added = toggleRow(EMPTY_SELECTION, rows, 'c');
    expect(ids(added)).toEqual(['c1', 'c2', 'c3']);
    expect(ids(toggleRow(added, rows, 'c'))).toEqual([]);
  });

  it('completes a half-selected row rather than clearing it', () => {
    expect(ids(toggleRow(state(['c2']), rows, 'c'))).toEqual(['c1', 'c2', 'c3']);
  });

  it('ignores a row the list does not hold', () => {
    const before = state(['a'], 'a');
    expect(toggleRow(before, rows, 'z')).toBe(before);
  });
});

describe('extendRange', () => {
  it('takes everything between the anchor and the row, inclusive', () => {
    expect(ids(extendRange(state(['a'], 'a'), rows, 'c'))).toEqual([
      'a',
      'b',
      'c1',
      'c2',
      'c3',
    ]);
  });

  it('reads the same range upwards', () => {
    expect(ids(extendRange(state(['d'], 'd'), rows, 'b'))).toEqual([
      'b',
      'c1',
      'c2',
      'c3',
      'd',
    ]);
  });

  it('leaves the anchor where it was, so the next one extends from there', () => {
    const first = extendRange(state(['a'], 'a'), rows, 'b');
    expect(first.anchor).toBe('a');
    expect(ids(extendRange(first, rows, 'd'))).toEqual([
      'a',
      'b',
      'c1',
      'c2',
      'c3',
      'd',
    ]);
  });

  it('keeps what was selected outside the range', () => {
    expect(ids(extendRange(state(['a', 'd'], 'a'), rows, 'b'))).toEqual(['a', 'b', 'd']);
  });

  it('is one row when there is no anchor yet, and anchors on it', () => {
    const result = extendRange(EMPTY_SELECTION, rows, 'b');
    expect(ids(result)).toEqual(['b']);
    expect(result.anchor).toBe('b');
  });

  it('ignores a row the list does not hold', () => {
    const before = state(['a'], 'a');
    expect(extendRange(before, rows, 'z')).toBe(before);
  });
});

describe('selectAllRows', () => {
  it('takes every id of every row', () => {
    const result = selectAllRows(rows);
    expect(ids(result)).toEqual(['a', 'b', 'c1', 'c2', 'c3', 'd']);
    expect(result.anchor).toBeNull();
  });
});

describe('clearSelection', () => {
  it('leaves nothing selected and no anchor', () => {
    const result = clearSelection();
    expect(ids(result)).toEqual([]);
    expect(result.anchor).toBeNull();
  });
});

describe('pruneSelection', () => {
  it('drops ids the list no longer holds', () => {
    expect(ids(pruneSelection(state(['a', 'gone']), rows))).toEqual(['a']);
  });

  it('drops one copy of a row without dropping the others', () => {
    const shorter: SelectionRow[] = [{ key: 'c', ids: ['c1', 'c2'] }];
    expect(ids(pruneSelection(state(['c1', 'c2', 'c3']), shorter))).toEqual(['c1', 'c2']);
  });

  it('forgets an anchor whose row has gone', () => {
    expect(pruneSelection(state(['a'], 'gone'), rows).anchor).toBeNull();
  });

  it('returns the same state when there is nothing to drop', () => {
    const before = state(['a', 'b'], 'a');
    expect(pruneSelection(before, rows)).toBe(before);
  });
});

describe('selectedRows and selectedIds', () => {
  it('read in list order, not in the order rows were ticked', () => {
    const ticked = toggleRow(toggleRow(state([]), rows, 'd'), rows, 'a');
    expect(selectedRows(ticked, rows).map((row) => row.key)).toEqual(['a', 'd']);
    expect(selectedIds(ticked, rows)).toEqual(['a', 'd']);
  });

  it('gives a bulk action every copy of a row', () => {
    expect(selectedIds(state(['c1', 'c2', 'c3']), rows)).toEqual(['c1', 'c2', 'c3']);
  });

  it('leaves out a row that is only half selected', () => {
    expect(selectedRows(state(['c1']), rows)).toEqual([]);
  });
});
