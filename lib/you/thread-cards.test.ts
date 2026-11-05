import { describe, expect, it } from 'vitest';
import { placeAfterReplies, withItem } from './thread-cards';

const m = (id: string, role: 'person' | 'advisor') => ({ id, role });
const card = (id: string, anchor: string | null) => ({ id, anchor });
const at = (item: { anchor: string | null }) => item.anchor;

describe('placeAfterReplies', () => {
  const thread = [m('p1', 'person'), m('a1', 'advisor'), m('a2', 'advisor'), m('p2', 'person'), m('a3', 'advisor'), m('p3', 'person')];

  it('draws a card after the last text of the reply to the text it hangs from', () => {
    const placed = placeAfterReplies(thread, [card('c1', 'p1'), card('c2', 'p2')], at);
    expect(placed.get('a2')?.map((c) => c.id)).toEqual(['c1']);
    expect(placed.get('a3')?.map((c) => c.id)).toEqual(['c2']);
  });

  it('keeps a card under your text until the reply arrives', () => {
    expect(placeAfterReplies(thread, [card('c3', 'p3')], at).get('p3')?.map((c) => c.id)).toEqual(['c3']);
  });

  it('keeps several cards on one text in the order given', () => {
    expect(placeAfterReplies(thread, [card('x', 'p1'), card('y', 'p1')], at).get('a2')?.map((c) => c.id)).toEqual(['x', 'y']);
  });

  it('leaves out a card whose text is not on the page or is gone', () => {
    expect(placeAfterReplies(thread, [card('old', 'p0'), card('gone', null)], at).size).toBe(0);
  });

  it('does not count a text first of theirs before you wrote as a reply', () => {
    const placed = placeAfterReplies([m('a0', 'advisor'), m('p1', 'person')], [card('c', 'p1')], at);
    expect([...placed.keys()]).toEqual(['p1']);
  });
});

describe('withItem', () => {
  it('replaces by id, or adds a new one at the end', () => {
    const list = [{ id: 'a', v: 1 }];
    expect(withItem(list, { id: 'a', v: 2 })).toEqual([{ id: 'a', v: 2 }]);
    expect(withItem(list, { id: 'b', v: 3 })).toEqual([{ id: 'a', v: 1 }, { id: 'b', v: 3 }]);
  });
});
