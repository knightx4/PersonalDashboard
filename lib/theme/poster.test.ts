import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatTheme, parseTheme, isPoster, paletteOf, posterFor } from '@/lib/theme';
import { applyTheme, themeAttribute, themeStyle } from '@/lib/theme/apply';
import { readTheme, THEME_SELECTORS } from '@/lib/theme/css';
import { relativeLuminance } from '@/lib/theme/oklch';
import {
  DEFAULT_PALETTE,
  PALETTE_IDS,
  PALETTES,
  POSTER_TOKENS,
  paletteTokens,
  posterTokens,
  sideOf,
} from '@/lib/theme/poster';

/** Every side of every palette, named for the failure message. */
const SIDES = PALETTES.flatMap((palette) => [
  { name: `${palette.id} day`, side: sideOf(palette, 'day') },
  { name: `${palette.id} night`, side: sideOf(palette, 'night') },
]);

/**
 * Lightbox is a poster: hand-picked palettes over one written block. The
 * contrast script measures every palette as a whole theme; what it cannot see
 * is the bands, which are not part of the shared token set, and the move of
 * every stored Lightbox onto the poster.
 */

const CSS = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
const BLOCK = readTheme(CSS, THEME_SELECTORS.poster!);
const NIGHT_BLOCK = readTheme(CSS, THEME_SELECTORS['poster-dark']!);

function ratio(a: string, b: string): number {
  const x = relativeLuminance(a);
  const y = relativeLuminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe('the poster block', () => {
  it('is the Primary palette, token for token', () => {
    const primary = paletteTokens(PALETTES.find((palette) => palette.id === DEFAULT_PALETTE)!);
    for (const [token, value] of Object.entries(primary)) {
      expect(`${token} ${BLOCK[token]}`).toBe(`${token} ${value}`);
    }
  });

  it('prints its dark side as Primary\'s night, token for token', () => {
    const night = paletteTokens(PALETTES.find((palette) => palette.id === DEFAULT_PALETTE)!.night);
    for (const [token, value] of Object.entries(night)) {
      expect(`${token} ${NIGHT_BLOCK[token]}`).toBe(`${token} ${value}`);
    }
  });
});

describe('every palette', () => {
  it('is listed once, in flat colours', () => {
    expect(PALETTES.map((palette) => palette.id)).toEqual([...PALETTE_IDS]);
    for (const { side } of SIDES) {
      for (const value of Object.values(paletteTokens(side))) expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('puts a readable label on each of its bands and on its highlight', () => {
    for (const { name, side } of SIDES) {
      for (const band of [...side.bands, side.highlight]) {
        expect(ratio(band.ink, band.fill), `${name} ${band.ink} on ${band.fill}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('draws its outline and its shadow hard enough to see on its paper and its cards', () => {
    for (const { name, side } of SIDES) {
      expect(ratio(side.ink, side.paper), name).toBeGreaterThanOrEqual(7);
      expect(ratio(side.ink, side.card), name).toBeGreaterThanOrEqual(7);
    }
  });

  it('keeps every band apart from the next, so three cards read as three colours', () => {
    for (const { name: id, side: palette } of SIDES) {
      // The middle band is always the light one, so neighbouring cards differ
      // in lightness as well as hue, which survives colour blindness and
      // greyscale.
      const [first, middle, last] = palette.bands.map((band) => band.fill);
      expect(ratio(first!, middle!), id).toBeGreaterThanOrEqual(1.8);
      expect(ratio(middle!, last!), id).toBeGreaterThanOrEqual(1.8);
    }
  });
});

describe('choosing Lightbox', () => {
  it('stores the default palette as the bare theme, and any other by name', () => {
    expect(formatTheme(parseTheme('poster:primary'))).toBe('poster');
    expect(formatTheme(parseTheme('POSTER:Ocean'))).toBe('poster:ocean');
    expect(parseTheme('poster:fluorescent')).toEqual({ kind: 'written', id: 'poster' });
  });

  it('moves every stored Lightbox onto the poster', () => {
    for (const value of ['lightbox', 'lightbox:260', 'lightbox:ember']) {
      const theme = parseTheme(value);
      expect(isPoster(theme), value).toBe(true);
      expect(paletteOf(theme)).toBe(DEFAULT_PALETTE);
    }
  });

  it('keeps the palette across light and dark', () => {
    const dark = posterFor('ocean', 'dark');
    expect(formatTheme(dark)).toBe('poster-dark:ocean');
    expect(themeAttribute(dark)).toBe('poster-dark');
    expect(themeStyle(dark)).toEqual(posterTokens('ocean', 'night'));
    expect(paletteOf(parseTheme('poster-dark:ocean'))).toBe('ocean');
    expect(formatTheme(posterFor(paletteOf(dark), 'light'))).toBe('poster:ocean');
  });

  it('renders on the poster block with the palette inline', () => {
    const theme = posterFor('nordic');
    expect(themeAttribute(theme)).toBe('poster');
    expect(themeStyle(theme)).toEqual(posterTokens('nordic'));
    expect(themeStyle(posterFor('primary'))).toBeUndefined();
  });

  it('takes its band colours off the document when another theme is chosen', () => {
    // A stand-in for <html>'s style: the one thing applyTheme touches.
    const props = new Map<string, string>();
    const root = {
      setAttribute() {},
      removeAttribute() {},
      style: {
        setProperty: (name: string, value: string) => props.set(name, value),
        removeProperty: (name: string) => props.delete(name),
        getPropertyValue: (name: string) => props.get(name) ?? '',
      },
    } as unknown as HTMLElement;
    applyTheme(root, posterFor('plum'));
    expect(root.style.getPropertyValue('--c-poster-band-1')).toBe('#6b3d78');
    applyTheme(root, parseTheme('dark'));
    for (const token of POSTER_TOKENS) expect(root.style.getPropertyValue(token)).toBe('');
  });
});
