import { describe, expect, it } from 'vitest';
import { ideaBasis, SECTION_QUERY_CHARS, sectionQueryText, swipeState } from './ideas';

/** The rules for keeping Learn now ideas as concepts (LEARN-NOW-SPEC, "Where ideas are kept"). */

describe('what a swipe writes on the idea', () => {
  it('writes known for Got it and shaky for Work on this', () => {
    expect(swipeState('known', null)).toBe('known');
    expect(swipeState('review', { established: 'declared' })).toBe('shaky');
    expect(swipeState('known', { established: 'inferred' })).toBe('known');
  });

  it('leaves the idea alone for Not now', () => {
    expect(swipeState('skipped', null)).toBeNull();
  });

  it('never overwrites a state a test established', () => {
    expect(swipeState('known', { established: 'tested' })).toBeNull();
    expect(swipeState('review', { established: 'tested' })).toBeNull();
  });
});

describe('where an idea came from', () => {
  it('names the article and the section, or the lead', () => {
    expect(ideaBasis('Startup company', 'Failure')).toBe(
      'Taken from the Wikipedia article "Startup company", section "Failure", for a Learn now card.',
    );
    expect(ideaBasis('Cobweb model', null)).toBe(
      'Taken from the lead of the Wikipedia article "Cobweb model", for a Learn now card.',
    );
  });
});

describe('embedding a section the catalogue has not', () => {
  it('heads the text with its title and keeps only the start', () => {
    const text = sectionQueryText('Startup company', 'Failure', `  ${'a'.repeat(SECTION_QUERY_CHARS + 50)}`);
    expect(text.startsWith('Startup company: Failure\n\n')).toBe(true);
    expect(text.length).toBe('Startup company: Failure\n\n'.length + SECTION_QUERY_CHARS);
  });
});
