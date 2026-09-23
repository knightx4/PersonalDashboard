import { describe, expect, it } from 'vitest';
import {
  clampPage,
  MERGE_LOG_PAGE_SIZE,
  shapeMergeLogCounts,
  shapeMergeLogRow,
  undoRefusal,
  type RawMergeLogRow,
} from './merge-log';

const raw: RawMergeLogRow = {
  id: 'm1',
  kind: 'theme',
  merged_at: '2026-09-23T16:57:57Z',
  undone_at: null,
  survivor_id: 's1',
  absorbed_id: 'a1',
  absorbed_name: 'Index inclusions',
  survivor_name_before: 'Data governance',
  survivor_name: 'Data governance and transparency',
  reason: 'Both are about how institutions publish data.',
  absorbed_items: [{ title: 'On indexes', path: 'Bulk/On indexes.md', quote: null }],
  absorbed_count: 1,
  survivor_items: [{ title: 'Gone note', path: null }],
  survivor_count: 4,
};

describe('shapeMergeLogRow', () => {
  it('keeps both names as they were and the survivor name now', () => {
    const row = shapeMergeLogRow(raw);
    expect(row.absorbed.name).toBe('Index inclusions');
    expect(row.survivor.name).toBe('Data governance');
    expect(row.survivorNameNow).toBe('Data governance and transparency');
    expect(row.reason).toBe('Both are about how institutions publish data.');
  });

  it('carries the items and the full count, with a missing field as null', () => {
    const row = shapeMergeLogRow(raw);
    expect(row.absorbed.items).toEqual([{ title: 'On indexes', path: 'Bulk/On indexes.md', quote: null }]);
    expect(row.survivor.items).toEqual([{ title: 'Gone note', path: null, quote: null }]);
    expect(row.survivor.count).toBe(4);
  });

  it('reads a survivor merged away since as null, and no items as none', () => {
    const row = shapeMergeLogRow({ ...raw, survivor_name: null, survivor_items: null, survivor_count: null });
    expect(row.survivorNameNow).toBeNull();
    expect(row.survivor.items).toEqual([]);
    expect(row.survivor.count).toBe(0);
  });
});

describe('shapeMergeLogCounts', () => {
  it('counts each kind and adds up the undone', () => {
    expect(
      shapeMergeLogCounts([
        { kind: 'theme', merges: 1282, undone: 2 },
        { kind: 'position', merges: 508, undone: 1 },
      ]),
    ).toEqual({ theme: 1282, position: 508, undone: 3 });
    expect(shapeMergeLogCounts([])).toEqual({ theme: 0, position: 0, undone: 0 });
  });
});

describe('clampPage', () => {
  const total = MERGE_LOG_PAGE_SIZE * 3 + 1;
  it('starts at the first page for nothing, nonsense or less than one', () => {
    expect(clampPage(undefined, total)).toBe(1);
    expect(clampPage('abc', total)).toBe(1);
    expect(clampPage('0', total)).toBe(1);
    expect(clampPage('-2', total)).toBe(1);
  });
  it('stops at the last page', () => {
    expect(clampPage('4', total)).toBe(4);
    expect(clampPage('99', total)).toBe(4);
    expect(clampPage(['2', '3'], total)).toBe(2);
    expect(clampPage('3', 0)).toBe(1);
  });
});

describe('undoRefusal', () => {
  it('passes the database wording through when the survivor was merged away', () => {
    const detail = 'The theme it was merged into has been merged or removed since. Undo that first.';
    expect(undoRefusal({ ok: false, reason: 'survivor-gone', detail })).toBe(detail);
  });
  it('names an unexpected failure as a failure', () => {
    expect(undoRefusal({ ok: false, reason: 'error', detail: 'boom' })).toBe('The undo failed: boom');
  });
});
