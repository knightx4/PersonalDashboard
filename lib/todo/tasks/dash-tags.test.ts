import { describe, expect, it } from 'vitest';
import { dashTags, timeTag } from './dash-tags';

/** The tags Dash puts on a todo it adds or edits (plan #2340.4). */

const TODAY = '2026-10-18';

describe('timeTag', () => {
  it('is now for today and before, eventually for no date or more than two weeks off', () => {
    expect(timeTag(TODAY, TODAY)).toBe('now');
    expect(timeTag('2026-10-01', TODAY)).toBe('now');
    expect(timeTag(null, TODAY)).toBe('eventually');
    expect(timeTag('2026-11-02', TODAY)).toBe('eventually');
  });

  it('is neither for a date in the next two weeks', () => {
    expect(timeTag('2026-10-19', TODAY)).toBeNull();
    expect(timeTag('2026-11-01', TODAY)).toBeNull();
  });
});

describe('dashTags', () => {
  it('adds the time tag to the ones sent, normalised and sorted', () => {
    expect(dashTags(undefined, null, TODAY)).toEqual({ ok: true, tags: ['eventually'] });
    expect(dashTags([' Errands '], TODAY, TODAY)).toEqual({ ok: true, tags: ['errands', 'now'] });
    expect(dashTags(['home'], '2026-10-20', TODAY)).toEqual({ ok: true, tags: ['home'] });
  });

  it('keeps a time tag the model sent rather than adding the other', () => {
    expect(dashTags(['now'], null, TODAY)).toEqual({ ok: true, tags: ['now'] });
    expect(dashTags(['eventually'], TODAY, TODAY)).toEqual({ ok: true, tags: ['eventually'] });
  });

  it('refuses a blank tag or one given twice', () => {
    expect(dashTags(['  '], null, TODAY)).toEqual({ ok: false, error: 'A tag needs a name.' });
    expect(dashTags(['car', 'Car'], null, TODAY)).toEqual({ ok: false, error: 'That tag is on the list twice.' });
  });
});
