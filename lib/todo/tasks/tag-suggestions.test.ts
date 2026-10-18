import { describe, expect, it } from 'vitest';
import { LEADING_TAGS, tagSuggestions } from '@/lib/todo/tasks/tags';

describe('tagSuggestions', () => {
  it('offers now and eventually first, before anything used', () => {
    expect(tagSuggestions([])).toEqual([...LEADING_TAGS]);
    expect(tagSuggestions(['home', 'car'])).toEqual(['now', 'eventually', 'home', 'car']);
  });

  it('does not offer now or eventually twice when they have been used', () => {
    expect(tagSuggestions(['eventually', 'home', 'now'])).toEqual(['now', 'eventually', 'home']);
  });

  it('narrows to the tags that start with what was typed, however it was cased', () => {
    expect(tagSuggestions(['home', 'health'], '  Ho')).toEqual(['home']);
    expect(tagSuggestions(['home'], 'e')).toEqual(['eventually']);
    expect(tagSuggestions(['home'], 'zz')).toEqual([]);
  });
});
