/**
 * The palette section of /dev/ui names tokens, and a name is wrong within a
 * month unless something checks it. This holds the strip to the tokens a theme
 * actually carries, the same way dev-ui-measurements.test.ts holds the numbers
 * to app/globals.css.
 */
import { describe, expect, it } from 'vitest';
import { FIXED_STRIP, HUE_SWEEP, PALETTE_STRIP } from '../app/dev/ui/palette-tokens';
import { generatePalette } from '../lib/theme/palette';
import { HUE_TOKENS, REFERENCE_PALETTES } from '../lib/theme/reference';

describe('the palette strip on /dev/ui', () => {
  it('names a token every theme declares', () => {
    for (const [, token] of PALETTE_STRIP) {
      for (const name of ['paper', 'ink', 'dusk'] as const) {
        expect(`${name} ${token} ${REFERENCE_PALETTES[name][token] !== undefined}`).toBe(
          `${name} ${token} true`,
        );
      }
    }
  });

  it('shows only tokens a chosen colour moves', () => {
    // The point of the strip is what a colour does. A band drawn from a token
    // the generator holds fixed would sit there unchanged and read as though
    // the colour had not taken.
    for (const [, token] of PALETTE_STRIP) {
      expect(`${token} ${HUE_TOKENS.includes(token)}`).toBe(`${token} true`);
    }
  });

  it('draws the utility that matches the token it names', () => {
    for (const [utility, token] of PALETTE_STRIP) {
      expect(utility).toBe(`bg-${token.replace('--c-', '')}`);
    }
  });

  it('keeps the second strip to colours no theme moves', () => {
    for (const utility of FIXED_STRIP) {
      const token = `--c-${utility.replace('bg-', '')}`;
      expect(`${token} ${REFERENCE_PALETTES.paper[token] !== undefined}`).toBe(`${token} true`);
      expect(`${token} ${HUE_TOKENS.includes(token)}`).toBe(`${token} false`);
    }
  });
});

describe('the hue sweep on /dev/ui', () => {
  it('walks the circle once, evenly, and lands on nothing twice', () => {
    expect(new Set(HUE_SWEEP).size).toBe(HUE_SWEEP.length);
    for (const hue of HUE_SWEEP) {
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
    const steps = HUE_SWEEP.slice(1).map((hue, index) => hue - HUE_SWEEP[index]!);
    expect(new Set(steps).size).toBe(1);
  });

  it('is a colour the generator can produce at every step', () => {
    for (const mode of ['light', 'dark'] as const) {
      for (const hue of HUE_SWEEP) {
        expect(generatePalette(mode, hue)['--c-accent-base']).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });
});
