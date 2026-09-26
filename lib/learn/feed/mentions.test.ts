import { describe, expect, it } from 'vitest';
import { MAX_MENTIONS, keepMentions, markMentions } from './mentions';

/**
 * The ideas a card mentions (plan #1056): which the writer's list keeps, and
 * where the page underlines them.
 */

describe('keeping mentions', () => {
  it('reads nothing from a column that is not a list', () => {
    expect(keepMentions(null)).toEqual([]);
    expect(keepMentions({ phrase: 'x' })).toEqual([]);
  });

  it('keeps at most three, one per phrase, without checking the text when none is given', () => {
    const raw = ['x', { phrase: '' }, ...['a', 'A', 'b', 'c', 'd'].map((phrase) => ({ phrase, why: 'w' }))];
    expect(keepMentions(raw).map((mention) => mention.phrase)).toEqual(['a', 'b', 'c']);
    expect(keepMentions(raw)).toHaveLength(MAX_MENTIONS);
  });

  it('drops a phrase that is not in the card, or is its name', () => {
    expect(
      keepMentions(
        [{ phrase: 'Tree search' }, { phrase: 'value network' }, { phrase: 'Search wins' }],
        { name: 'Search wins', texts: ['It used tree search to play.', null] },
      ),
    ).toEqual([{ phrase: 'Tree search', why: '' }]);
  });
});

describe('marking mentions', () => {
  const mentions = [
    { phrase: 'tree search', why: 'How it chose moves.' },
    { phrase: 'value network', why: 'How it scored boards.' },
  ];

  it('underlines each mention once, where it first appears, in the text own case', () => {
    const [first, second] = markMentions(
      ['Tree search picked moves and a value network scored them.', 'More tree search later.'],
      mentions,
    );
    expect(first).toEqual([
      { text: 'Tree search', mention: mentions[0] },
      { text: ' picked moves and a ', mention: null },
      { text: 'value network', mention: mentions[1] },
      { text: ' scored them.', mention: null },
    ]);
    expect(second).toEqual([{ text: 'More tree search later.', mention: null }]);
  });

  it('keeps the first of two mentions that overlap, and the longer when they start together', () => {
    const overlapping = [
      { phrase: 'search', why: '' },
      { phrase: 'tree search', why: '' },
      { phrase: 'search later', why: '' },
    ];
    const [parts] = markMentions(['A tree search later.'], overlapping);
    expect(parts.map((part) => [part.text, part.mention?.phrase ?? null])).toEqual([
      ['A ', null],
      ['tree search', 'tree search'],
      [' later.', null],
    ]);
  });

  it('leaves text with no mentions whole, and an empty text as one empty part', () => {
    expect(markMentions(['Plain.', ''], [])).toEqual([
      [{ text: 'Plain.', mention: null }],
      [{ text: '', mention: null }],
    ]);
  });
});
