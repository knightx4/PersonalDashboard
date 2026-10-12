import { describe, expect, it } from 'vitest';
import { locateAnchor, makeAnchor, similarity } from './anchor';

const DOC = `# Why money is the odd good out

Money keeps its value because everyone expects everyone else to accept it. That expectation is the whole of its worth.

Gold was money for centuries, yet nobody eats gold. A good that is valued only for being passed on behaves unlike any other.`;

const quoteRange = (doc: string, quote: string) => {
  const from = doc.indexOf(quote);
  return { from, to: from + quote.length };
};

describe('makeAnchor', () => {
  it('keeps the quote, 32 characters either side and the offset', () => {
    const { from, to } = quoteRange(DOC, 'nobody eats gold');
    const anchor = makeAnchor(DOC, from, to);
    expect(anchor.quote).toBe('nobody eats gold');
    expect(anchor.prefix).toHaveLength(32);
    expect(anchor.prefix.endsWith('for centuries, yet ')).toBe(true);
    expect(anchor.suffix.startsWith('. A good')).toBe(true);
    expect(anchor.offset).toBe(from);
  });
});

describe('locateAnchor', () => {
  const quote = 'Gold was money for centuries, yet nobody eats gold.';
  const { from, to } = quoteRange(DOC, quote);
  const anchor = makeAnchor(DOC, from, to);

  it('finds the note at its offset when nothing moved', () => {
    expect(locateAnchor(DOC, anchor)).toEqual({ from, to, how: 'offset' });
  });

  it('finds it by its quote after an edit above it', () => {
    const edited = DOC.replace('# Why money', '# Why, after all this time, money');
    const at = locateAnchor(edited, anchor);
    expect(at?.how).toBe('quote');
    expect(edited.slice(at!.from, at!.to)).toBe(quote);
  });

  it('takes the copy whose surroundings match when the quote appears twice', () => {
    const twice = `${quote}\n\n${DOC}`;
    const at = locateAnchor(twice, { ...anchor, offset: 5 });
    expect(at?.how).toBe('quote');
    expect(at!.from).toBe(twice.lastIndexOf(quote));
  });

  it('finds the sentence after a few words in it changed', () => {
    const edited = DOC.replace(quote, 'Gold was money for many centuries, though nobody eats gold.');
    const at = locateAnchor(edited, anchor);
    expect(at?.how).toBe('fuzzy');
    expect(edited.slice(at!.from, at!.to)).toBe('Gold was money for many centuries, though nobody eats gold.');
  });

  it('gives up when the text has gone', () => {
    const cut = DOC.replace(quote, 'Silver too.');
    expect(locateAnchor(cut, anchor)).toBeNull();
  });
});

describe('similarity', () => {
  it('is 1 for the same text and low for unrelated text', () => {
    expect(similarity('nobody eats gold', 'nobody eats gold')).toBe(1);
    expect(similarity('nobody eats gold', 'the tax on petrol')).toBeLessThan(0.3);
  });
});
