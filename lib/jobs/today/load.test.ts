import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isPrepped } from './load';

describe('isPrepped', () => {
  it('counts the note you typed', () => {
    expect(isPrepped({ prep_notes: 'Ask about the reporting line.', prep_note: null })).toBe(true);
  });

  it('counts the note the app generated', () => {
    expect(
      isPrepped({ prep_notes: null, prep_note: { roundSummary: 'A screen on 2 March.' } }),
    ).toBe(true);
  });

  it('is false for a round with neither', () => {
    expect(isPrepped({ prep_notes: null, prep_note: null })).toBe(false);
    // Whitespace is not prep, and it is what an emptied textarea leaves.
    expect(isPrepped({ prep_notes: '   \n', prep_note: null })).toBe(false);
  });
});

/**
 * The select list is written out by hand because supabase-js parses it at the
 * type level, so a column the mapper reads can simply never be asked for --
 * and nothing fails, the round just reads as unprepared for ever.
 */
describe('the interviews select list', () => {
  it('asks for both prep columns', () => {
    const source = readFileSync(new URL('./load.ts', import.meta.url), 'utf8');
    const select = source.match(/'id, application_id, round, kind[^']*'/)?.[0] ?? '';
    expect(select).toContain('prep_notes');
    expect(select).toContain('prep_note,');
  });
});
