import { describe, expect, it } from 'vitest';
import { heuristicParseReferences } from './parse-heuristic';

/**
 * The fixture is a real reply, pasted verbatim, because that is what this
 * function exists to read. A synthetic list of "Author — Title" lines would
 * pass anything: the reason parsing is not trivial is that a good
 * recommendation comes wrapped in a sentence explaining why it is there, and
 * the sentence has to survive without contaminating the citation.
 */
const REPLY = `Sen, Inequality Reexamined or the essay "Equality of What?" for the capability move.

• Michael Walzer, Spheres of Justice. Best fit for your intuition. His claim is that the problem isn't unequal money so much as money being universally convertible; some goods should have blocked exchanges. Sandel's What Money Can't Buy is the popular version.

• Dworkin's "Equality of Resources," which runs an auction thought experiment with equal starting clamshells, then shows why you still need insurance markets to handle luck.

• Hayek's "The Use of Knowledge in Society," for the strongest case that prices are a signaling and coordination device rather than a valuation device.

• Glen Weyl's quadratic voting and quadratic funding, if you want a live mechanism-design attempt to break one-dollar-one-vote while keeping intensity of preference legible.`;

describe('heuristicParseReferences on a real reply', () => {
  const refs = heuristicParseReferences(REPLY);

  it('finds one candidate per recommendation', () => {
    expect(refs).toHaveLength(5);
  });

  it('strips the bullets', () => {
    for (const ref of refs) {
      expect(ref.title.startsWith('•'), ref.title).toBe(false);
      expect(ref.title.startsWith('-'), ref.title).toBe(false);
    }
  });

  it('reads "Surname, Title" as author first', () => {
    expect(refs[0].author).toBe('Sen');
    expect(refs[0].title).toMatch(/^Inequality Reexamined/);
  });

  it('reads a full name before a title', () => {
    expect(refs[1].author).toBe('Michael Walzer');
    expect(refs[1].title).toBe('Spheres of Justice');
  });

  it('keeps the recommender\'s reason out of the title', () => {
    // "Best fit for your intuition. His claim is that..." is commentary. A
    // title carrying it searches for nothing.
    expect(refs[1].title).not.toContain('Best fit');
    expect(refs[1].title).not.toContain('blocked exchanges');
  });

  it('keeps that reason rather than discarding it', () => {
    // It is better than anything the resolver will write: it says why this
    // source speaks to the question that was actually asked.
    expect(refs[1].why).toContain('Best fit for your intuition');
  });

  it('handles a possessive citation', () => {
    expect(refs[2].title).toContain('Equality of Resources');
    expect(refs[3].title).toContain('The Use of Knowledge in Society');
  });

  it('keeps the raw line for the confirm screen', () => {
    expect(refs[3].raw).toContain('Hayek');
  });
});

describe('heuristicParseReferences shapes', () => {
  it('reads "Title by Author"', () => {
    const [ref] = heuristicParseReferences('Spheres of Justice by Michael Walzer');
    expect(ref.title).toBe('Spheres of Justice');
    expect(ref.author).toBe('Michael Walzer');
  });

  it('does not invent an author from a comma inside a title', () => {
    // "Prices, markets and the coordination problem" is one title. A wrong
    // author is worse than none, because the resolver searches on it.
    const [ref] = heuristicParseReferences('Prices, markets and the coordination problem');
    expect(ref.author).toBeNull();
    expect(ref.title).toBe('Prices, markets and the coordination problem');
  });

  it('pulls a URL out of the line and keeps the rest as the title', () => {
    const [ref] = heuristicParseReferences(
      '- The Use of Knowledge in Society https://www.econlib.org/library/Essays/hykKnw.html',
    );
    expect(ref.url).toBe('https://www.econlib.org/library/Essays/hykKnw.html');
    expect(ref.title).toBe('The Use of Knowledge in Society');
  });

  it('accepts a bare URL as a reference', () => {
    const [ref] = heuristicParseReferences('https://example.org/paper.pdf');
    expect(ref.url).toBe('https://example.org/paper.pdf');
    expect(ref).toBeDefined();
  });

  it('drops separators, numbering artefacts and blank lines', () => {
    expect(heuristicParseReferences('---\n\n1.\n***\n   ')).toHaveLength(0);
  });

  it('drops a line that introduces the list', () => {
    const refs = heuristicParseReferences('Here are some things to read:\n- Spheres of Justice');
    expect(refs).toHaveLength(1);
    expect(refs[0].title).toBe('Spheres of Justice');
  });

  it('strips numbered leaders as well as bullets', () => {
    const refs = heuristicParseReferences('1. Spheres of Justice\n2) Equality of What?');
    expect(refs.map((r) => r.title)).toEqual(['Spheres of Justice', 'Equality of What?']);
  });

  it('unwraps a quoted title', () => {
    const [ref] = heuristicParseReferences('"The Use of Knowledge in Society"');
    expect(ref.title).toBe('The Use of Knowledge in Society');
  });

  it('returns nothing for empty input', () => {
    expect(heuristicParseReferences('')).toEqual([]);
    expect(heuristicParseReferences('   \n\n  ')).toEqual([]);
  });
});
