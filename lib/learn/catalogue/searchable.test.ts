import { describe, expect, it } from 'vitest';
import { MIN_SEARCHABLE_SECTION_CHARS, isSearchableSection } from './searchable';

const prose = 'Tell is a mound formed by generations of people living on the same spot. '.repeat(5);

describe('which article sections a claim may be matched against', () => {
  it('takes a section of 300 characters or more', () => {
    expect(isSearchableSection({ heading: 'History', text: prose })).toBe(true);
    expect(isSearchableSection({ heading: 'History', text: 'a'.repeat(MIN_SEARCHABLE_SECTION_CHARS) })).toBe(true);
  });

  it('refuses a section under 300 characters, counting trimmed text', () => {
    expect(isSearchableSection({ heading: 'Characteristics', text: 'a'.repeat(150) })).toBe(false);
    const padded = `   ${'a'.repeat(MIN_SEARCHABLE_SECTION_CHARS - 1)}\n\n  `;
    expect(isSearchableSection({ heading: 'History', text: padded })).toBe(false);
  });

  it('refuses a short lead section as well', () => {
    expect(isSearchableSection({ heading: null, text: 'A tell is a mound.' })).toBe(false);
    expect(isSearchableSection({ heading: null, text: prose })).toBe(true);
  });

  it('refuses link lists whatever their length or case', () => {
    for (const heading of ['See also', 'External links', 'References', 'Further reading', 'Notes', 'Bibliography', 'Sources', 'Works cited', 'SEE ALSO', ' see  also ']) {
      expect(isSearchableSection({ heading, text: prose })).toBe(false);
    }
  });

  it('keeps a heading that only contains one of those words', () => {
    expect(isSearchableSection({ heading: 'Primary sources', text: prose })).toBe(true);
    expect(isSearchableSection({ heading: 'Cultural references', text: prose })).toBe(true);
  });
});
