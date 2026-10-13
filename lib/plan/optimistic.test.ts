import { describe, expect, it } from 'vitest';
import { applyRowChange, inOrder, swapSibling, type RowFields } from './optimistic';

const row: RowFields = { status: 'not_started', priority: 2, assignee: null };

describe('applyRowChange', () => {
  it('sets the priority and nothing else', () => {
    expect(applyRowChange(row, { kind: 'priority', priority: 1 })).toEqual({ ...row, priority: 1 });
  });

  it('marks a step underway yours when it had no mark', () => {
    expect(applyRowChange(row, { kind: 'status', status: 'in_progress' }).assignee).toBe('me');
  });

  it('leaves an existing mark on a step moved to in progress', () => {
    const marked = { ...row, assignee: 'me' as const };
    expect(applyRowChange(marked, { kind: 'status', status: 'in_progress' }).assignee).toBe('me');
  });

  it('takes the mark off a step put back to not started', () => {
    const marked: RowFields = { ...row, status: 'in_progress', assignee: 'me' };
    expect(applyRowChange(marked, { kind: 'status', status: 'not_started' }).assignee).toBeNull();
  });

  it('sets and clears the assignee', () => {
    const mine = applyRowChange(row, { kind: 'assignee', assignee: 'me' });
    expect(mine.assignee).toBe('me');
    expect(applyRowChange(mine, { kind: 'assignee', assignee: null }).assignee).toBeNull();
  });
});

describe('swapSibling', () => {
  it('swaps with the neighbour', () => {
    expect(swapSibling(['a', 'b', 'c'], { id: 'b', direction: 'up' })).toEqual(['b', 'a', 'c']);
    expect(swapSibling(['a', 'b', 'c'], { id: 'b', direction: 'down' })).toEqual(['a', 'c', 'b']);
  });

  it('stays put at either end and for an unknown id', () => {
    const ids = ['a', 'b'];
    expect(swapSibling(ids, { id: 'a', direction: 'up' })).toBe(ids);
    expect(swapSibling(ids, { id: 'b', direction: 'down' })).toBe(ids);
    expect(swapSibling(ids, { id: 'z', direction: 'up' })).toBe(ids);
  });
});

describe('inOrder', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('follows the ids', () => {
    expect(inOrder(items, ['c', 'a', 'b']).map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });

  it('puts an item the ids lack last and skips an id with no item', () => {
    expect(inOrder(items, ['b', 'x']).map((i) => i.id)).toEqual(['b', 'a', 'c']);
  });
});
