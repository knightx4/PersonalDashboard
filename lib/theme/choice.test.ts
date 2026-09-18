import { describe, expect, it } from 'vitest';
import { formatTheme, parseTheme, writtenId, SYSTEM_THEME } from '@/lib/theme';
import { shouldRepairTheme, themeAttribute, themeStyle } from '@/lib/theme/apply';
import { generatePalette } from '@/lib/theme/palette';

/**
 * One string holds three different things, so the reading of it is where this
 * can go wrong: an account that has chosen nothing, an account holding one of
 * the four written themes, and an account holding a mode and a colour. The
 * third now has three modes in it rather than two -- Lightbox takes a colour
 * as well, on its bench.
 */

describe('parseTheme', () => {
  it('reads nothing as following the system', () => {
    for (const value of [null, undefined, '', '   ']) {
      expect(parseTheme(value)).toEqual(SYSTEM_THEME);
    }
  });

  it('still reads the four written themes', () => {
    for (const id of ['paper', 'ink', 'lightbox', 'dusk'] as const) {
      expect(parseTheme(id)).toEqual({ kind: 'written', id });
    }
  });

  it('reads a mode on its own', () => {
    expect(parseTheme('light')).toEqual({ kind: 'generated', mode: 'light', hue: null });
    expect(parseTheme('dark')).toEqual({ kind: 'generated', mode: 'dark', hue: null });
    // Lightbox with no colour is the written Lightbox, which is the same
    // palette under a name that already existed.
    expect(parseTheme('lightbox')).toEqual({ kind: 'written', id: 'lightbox' });
  });

  it('reads a mode and a colour', () => {
    expect(parseTheme('dark:284')).toEqual({ kind: 'generated', mode: 'dark', hue: 284 });
    expect(parseTheme('lightbox:155')).toEqual({ kind: 'generated', mode: 'lightbox', hue: 155 });
  });

  it('brings a hue back onto the circle', () => {
    expect(parseTheme('dark:400')).toEqual({ kind: 'generated', mode: 'dark', hue: 40 });
    expect(parseTheme('dark:-320')).toEqual({ kind: 'generated', mode: 'dark', hue: 40 });
    expect(parseTheme('dark:360')).toEqual({ kind: 'generated', mode: 'dark', hue: 0 });
  });

  it('reads anything it does not understand as no choice at all', () => {
    // Better than guessing light: a value this app cannot read is not evidence
    // of what somebody wanted.
    for (const value of ['riso', 'sideways', 'dark:pink', 'dark:NaN', ':90', 'lightbox:pink']) {
      expect(parseTheme(value)).toEqual(SYSTEM_THEME);
    }
  });
});

describe('formatTheme', () => {
  it('round-trips everything that can be stored', () => {
    for (const value of [
      'paper',
      'ink',
      'lightbox',
      'dusk',
      'light',
      'dark',
      'dark:284',
      'lightbox:155',
    ]) {
      expect(formatTheme(parseTheme(value))).toBe(value);
    }
  });

  it('stores nothing for following the system', () => {
    expect(formatTheme(SYSTEM_THEME)).toBeNull();
  });
});

describe('putting a theme on the document', () => {
  it('leaves the attribute off when nothing was chosen', () => {
    expect(themeAttribute(SYSTEM_THEME)).toBeUndefined();
    expect(themeStyle(SYSTEM_THEME)).toBeUndefined();
  });

  it('renders a written theme exactly as it did before, with no tokens of its own', () => {
    for (const id of ['paper', 'ink', 'lightbox', 'dusk'] as const) {
      const theme = parseTheme(id);
      expect(themeAttribute(theme)).toBe(id);
      expect(themeStyle(theme)).toBeUndefined();
    }
  });

  it('renders a mode with no colour as the written theme it already is', () => {
    expect(themeAttribute(parseTheme('light'))).toBe('paper');
    expect(themeAttribute(parseTheme('dark'))).toBe('ink');
    expect(themeStyle(parseTheme('light'))).toBeUndefined();
    expect(themeStyle(parseTheme('dark'))).toBeUndefined();
  });

  it('renders a coloured Lightbox on Lightbox\'s own block', () => {
    // The block carries what no token can: the glow round a sheet, the wash
    // across the bench, and the two colour-schemes a two-polarity theme needs.
    const theme = parseTheme('lightbox:155');
    expect(themeAttribute(theme)).toBe('lightbox');
    expect(themeStyle(theme)).toEqual(generatePalette('lightbox', 155));
  });

  it('writes the generated tokens for a mode with a colour', () => {
    const theme = parseTheme('dark:284');
    // The polarity still comes from the written block: the grain, the
    // colour-scheme and the scope defaults are all in there.
    expect(themeAttribute(theme)).toBe('ink');

    const style = themeStyle(theme);
    expect(style).toEqual(generatePalette('dark', 284));
    expect(Object.keys(style!).every((token) => token.startsWith('--c-'))).toBe(true);
    expect(style!['--c-canvas']).toMatch(/^#[0-9a-f]{6}$/);
  });
});

/**
 * The repair that put every theme back to Lightbox (note bce3f7e5).
 *
 * The picker is handed the account's theme by a render, and saving a theme
 * starts a render -- so the value it is holding can predate the write it is
 * answering. While the repair fired on any disagreement, that stale value was
 * put back on the document and saved over the new one, and the theme could not
 * be changed at all.
 */
describe('shouldRepairTheme', () => {
  it('puts a stored theme onto a document that carries no choice', () => {
    // The case it exists for: a device with no cookie, so the server rendered
    // the system default over an account that has actually chosen something.
    expect(shouldRepairTheme(null, 'lightbox')).toBe(true);
    expect(shouldRepairTheme(null, 'dark:284')).toBe(true);
  });

  it('leaves a document that is already showing the stored theme alone', () => {
    expect(shouldRepairTheme('lightbox', 'lightbox')).toBe(false);
  });

  it('never overwrites a choice the document is already carrying', () => {
    // The bug. The document has the theme just chosen; `stored` is the one it
    // replaced. Repairing here reverts the choice and then saves the revert.
    expect(shouldRepairTheme('dark:284', 'lightbox')).toBe(false);
    expect(shouldRepairTheme('paper', 'ink')).toBe(false);
  });

  it('does not treat following the system as something to restore', () => {
    // An account that is not saying is not an account asking for the system
    // default, and it is also what a failed read looks like.
    expect(shouldRepairTheme(null, null)).toBe(false);
    expect(shouldRepairTheme('dusk', null)).toBe(false);
  });
});

describe('writtenId', () => {
  it('names a written theme and nothing else', () => {
    expect(writtenId(parseTheme('dusk'))).toBe('dusk');
    expect(writtenId(parseTheme('dark:284'))).toBeNull();
    expect(writtenId(SYSTEM_THEME)).toBeNull();
  });
});
