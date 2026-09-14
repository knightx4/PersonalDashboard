import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readTheme, THEME_SELECTORS } from '@/lib/theme/css';
import { hexToOklch, oklchToHex, relativeLuminance } from '@/lib/theme/oklch';
import { generatePalette } from '@/lib/theme/palette';
import {
  ACCENT_TOKENS,
  HUE_TOKENS,
  LIGHT_CAST,
  REFERENCE_HUE,
  REFERENCE_PALETTES,
} from '@/lib/theme/reference';

/** The shortest way round the circle between two hues, in degrees. */
function apart(a: number, b: number): number {
  const gap = Math.abs(((a - b) % 360) + 360) % 360;
  return gap > 180 ? 360 - gap : gap;
}

/** Every fifteen degrees is twenty-four hues, which is the same sweep the contrast check walks. */
const SWEEP = Array.from({ length: 24 }, (_, step) => step * 15);

const FIXED_TOKENS = Object.keys(REFERENCE_PALETTES.paper).filter(
  (token) => !HUE_TOKENS.includes(token),
);

describe('the reference palettes', () => {
  it('say what app/globals.css says', () => {
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
    for (const name of ['paper', 'ink', 'dusk'] as const) {
      const written = readTheme(css, THEME_SELECTORS[name]);
      const baked = REFERENCE_PALETTES[name];
      for (const token of Object.keys(baked)) {
        expect(`${name} ${token} ${baked[token]}`).toBe(`${name} ${token} ${written[token]}`);
      }
      // The other direction, so a token added to globals.css is not silently
      // missing from a generated theme.
      const colours = Object.keys(written).filter(
        (token) => token.startsWith('--c-') && /^#[0-9a-f]{6}$/i.test(written[token]),
      );
      expect(colours.sort()).toEqual(Object.keys(baked).sort());
    }
  });

  it('divide every token into one that takes the colour and one that does not', () => {
    expect(HUE_TOKENS.length + FIXED_TOKENS.length).toBe(
      Object.keys(REFERENCE_PALETTES.paper).length,
    );
    for (const token of HUE_TOKENS) {
      expect(REFERENCE_PALETTES.paper[token]).toBeDefined();
      expect(REFERENCE_PALETTES.dusk[token]).toBeDefined();
    }
  });
});

describe('generatePalette', () => {
  it('gives back Paper for light with no colour and Ink for dark with no colour', () => {
    expect(generatePalette('light', null)).toEqual(REFERENCE_PALETTES.paper);
    expect(generatePalette('dark', null)).toEqual(REFERENCE_PALETTES.ink);
  });

  it('gives back Dusk for dark at the hue read off its own ground', () => {
    expect(generatePalette('dark', REFERENCE_HUE.dusk)).toEqual(REFERENCE_PALETTES.dusk);
  });

  it('reflects as much light as the reference did, all the way round the circle', () => {
    // The property every contrast ratio in the app rests on, and the reason
    // the generator holds luminance rather than OKLCH lightness: both sides of
    // every pair are matched, so a generated palette measures exactly what the
    // reference it came from measured. scripts/check-contrast.ts proves the
    // consequence at these same hues; this is the cause.
    for (const mode of ['light', 'dark'] as const) {
      const reference = mode === 'light' ? LIGHT_CAST : REFERENCE_PALETTES.dusk;
      for (const hue of SWEEP) {
        const palette = generatePalette(mode, hue);
        for (const token of HUE_TOKENS) {
          const drift = Math.abs(
            relativeLuminance(palette[token]) - relativeLuminance(reference[token]),
          );
          // Rounding to eight bits a channel is what is left, and near white
          // one of those steps is worth about six thousandths of luminance --
          // which moves a contrast ratio by well under a percent. A hue that
          // could not reach the luminance in gamut would fail here.
          expect(`${mode} ${hue} ${token} ${drift < 0.008}`).toBe(`${mode} ${hue} ${token} true`);
        }
      }
    }
  });

  it('keeps a light theme measuring what Paper measures, through both turns', () => {
    // The light half takes two turns to get anywhere -- Paper to LIGHT_CAST,
    // then LIGHT_CAST to the hue you asked for -- and each one rounds to eight
    // bits at the end. So the allowance here is two of those steps rather than
    // one, and the point of the test is that the two do not compound into
    // something a reader would notice.
    for (const hue of SWEEP) {
      const palette = generatePalette('light', hue);
      for (const token of HUE_TOKENS) {
        const drift = Math.abs(
          relativeLuminance(palette[token]) - relativeLuminance(REFERENCE_PALETTES.paper[token]),
        );
        expect(`${hue} ${token} ${drift < 0.016}`).toBe(`${hue} ${token} true`);
      }
    }
  });

  it('does not move a lightness further than it has to', () => {
    // Luminance is held, so perceptual lightness gives a little where the hue
    // is weighted differently. It must stay a little: a ground that visibly
    // darkened on its way round the circle would be a different theme, not the
    // same one in another colour.
    for (const mode of ['light', 'dark'] as const) {
      const reference = mode === 'light' ? LIGHT_CAST : REFERENCE_PALETTES.dusk;
      for (const hue of SWEEP) {
        const palette = generatePalette(mode, hue);
        for (const token of HUE_TOKENS) {
          const drift = Math.abs(hexToOklch(palette[token]).l - hexToOklch(reference[token]).l);
          expect(`${mode} ${hue} ${token} ${drift < 0.06}`).toBe(`${mode} ${hue} ${token} true`);
        }
      }
    }
  });

  it('leaves the colours that carry a meaning alone', () => {
    for (const mode of ['light', 'dark'] as const) {
      const reference = REFERENCE_PALETTES[mode === 'light' ? 'paper' : 'dusk'];
      for (const hue of SWEEP) {
        const palette = generatePalette(mode, hue);
        for (const token of FIXED_TOKENS) {
          expect(`${hue} ${token} ${palette[token]}`).toBe(`${hue} ${token} ${reference[token]}`);
        }
      }
    }
  });

  it('puts a light theme\'s accent on the colour that was asked for', () => {
    // What #454 settled. Paper's page and Paper's accent sit a hundred and
    // eighty apart, so a light theme that rotated Paper as one thing would
    // answer green with a green page and magenta links.
    for (const hue of SWEEP) {
      const accent = hexToOklch(generatePalette('light', hue)['--c-accent-base']);
      expect(`${hue} ${apart(accent.h, hue) < 2}`).toBe(`${hue} true`);
    }
  });

  it('brings Paper\'s accent onto Paper\'s page hue, where it was opposite it', () => {
    const page = hexToOklch(REFERENCE_PALETTES.paper['--c-page']).h;
    expect(apart(hexToOklch(REFERENCE_PALETTES.paper['--c-accent-base']).h, page)).toBeGreaterThan(
      150,
    );
    expect(apart(hexToOklch(LIGHT_CAST['--c-accent-base']).h, page)).toBeLessThan(2);
  });

  it('keeps the accent a real colour at every hue, and no louder than Paper asked', () => {
    // Lightness is held, so a hue whose chroma does not fit sRGB at that
    // lightness gives chroma up rather than going darker -- which is the trade
    // that keeps every theme as readable as Paper. What must not happen is the
    // accent washing out to a grey, or coming back more saturated than the one
    // colour in this palette anybody chose.
    const asked = hexToOklch(REFERENCE_PALETTES.paper['--c-accent-base']).c;
    for (const hue of SWEEP) {
      const accent = hexToOklch(generatePalette('light', hue)['--c-accent-base']);
      expect(`${hue} floor ${accent.c > 0.08}`).toBe(`${hue} floor true`);
      expect(`${hue} ceiling ${accent.c <= asked + 0.002}`).toBe(`${hue} ceiling true`);
    }
  });

  it('rotates light about LIGHT_CAST, which is Paper everywhere but the accent', () => {
    for (const token of Object.keys(REFERENCE_PALETTES.paper)) {
      if (ACCENT_TOKENS.includes(token)) continue;
      expect(`${token} ${LIGHT_CAST[token]}`).toBe(`${token} ${REFERENCE_PALETTES.paper[token]}`);
    }
    expect(generatePalette('light', REFERENCE_HUE.paper)).toEqual(LIGHT_CAST);
  });

  it('reads a hue outside 0-360 as the same place on the circle', () => {
    expect(generatePalette('dark', 40)).toEqual(generatePalette('dark', 400));
    expect(generatePalette('dark', 40)).toEqual(generatePalette('dark', -320));
  });
});

describe('oklch', () => {
  it('round-trips every written colour without moving it', () => {
    for (const palette of Object.values(REFERENCE_PALETTES)) {
      for (const [token, hex] of Object.entries(palette)) {
        expect(`${token} ${oklchToHex(hexToOklch(hex))}`).toBe(`${token} ${hex}`);
      }
    }
  });

  it('gives up chroma rather than lightness when a colour will not fit in sRGB', () => {
    // A yellow that saturated does not exist in sRGB at any lightness.
    const asked = { l: 0.5, c: 0.35, h: 100 };
    const got = hexToOklch(oklchToHex(asked));
    expect(got.c).toBeLessThan(asked.c);
    expect(Math.abs(got.l - asked.l)).toBeLessThan(0.004);
  });
});
