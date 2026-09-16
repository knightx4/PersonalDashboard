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
  LIGHTBOX_HUE_TOKENS,
  REFERENCE_HUE,
  REFERENCE_PALETTES,
} from '@/lib/theme/reference';

/** A colour the reference tables are allowed to hold: flat, or flat with alpha. */
const COLOUR = /^(#[0-9a-f]{6}|rgba?\([\d.\s,/]+\))$/i;

const HEX = /^#[0-9a-f]{6}$/i;

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
    for (const name of ['paper', 'ink', 'dusk', 'lightbox'] as const) {
      const written = readTheme(css, THEME_SELECTORS[name]);
      const baked = REFERENCE_PALETTES[name];
      for (const token of Object.keys(baked)) {
        expect(`${name} ${token} ${baked[token]}`).toBe(`${name} ${token} ${written[token]}`);
      }
      // The other direction, so a token added to globals.css is not silently
      // missing from a generated theme.
      const colours = Object.keys(written).filter(
        (token) => token.startsWith('--c-') && COLOUR.test(written[token]),
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

  it('turn only the bench on Lightbox, and nothing the sheets are made of', () => {
    // #467's answer. The sheets are lit paper laid on the bench, so they keep
    // their own colours; the four of them are written with alpha as well,
    // which is a second reason the generator must not touch them.
    for (const token of LIGHTBOX_HUE_TOKENS) {
      expect(`${token} ${REFERENCE_PALETTES.lightbox[token] !== undefined}`).toBe(`${token} true`);
    }
    for (const token of ['--c-canvas', '--c-surface', '--c-raised', '--c-sunken', '--c-ink']) {
      expect(`${token} ${LIGHTBOX_HUE_TOKENS.includes(token)}`).toBe(`${token} false`);
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

describe('generatePalette on Lightbox', () => {
  /** The bench tokens that are flat hex, which is all of them but the outline. */
  const BENCH = LIGHTBOX_HUE_TOKENS.filter((token) =>
    HEX.test(REFERENCE_PALETTES.lightbox[token]),
  );

  it('gives back Lightbox with no colour, and at the hue read off its bench', () => {
    expect(generatePalette('lightbox', null)).toEqual(REFERENCE_PALETTES.lightbox);
    expect(generatePalette('lightbox', REFERENCE_HUE.lightbox)).toEqual(
      REFERENCE_PALETTES.lightbox,
    );
  });

  it('puts the bench on the colour that was asked for', () => {
    // Within four degrees rather than within two, which is what eight bits a
    // channel is worth at the bench's chroma: it carries 0.029 where a light
    // theme's accent carries 0.15, and the fewer steps a colour has to round
    // between, the further one of them moves the hue.
    for (const hue of SWEEP) {
      const bench = hexToOklch(generatePalette('lightbox', hue)['--c-page']);
      expect(`${hue} ${apart(bench.h, hue) < 4}`).toBe(`${hue} true`);
    }
  });

  it('reflects as much light as Lightbox did, all the way round the circle', () => {
    for (const hue of SWEEP) {
      const palette = generatePalette('lightbox', hue);
      for (const token of BENCH) {
        const drift = Math.abs(
          relativeLuminance(palette[token]) -
            relativeLuminance(REFERENCE_PALETTES.lightbox[token]),
        );
        expect(`${hue} ${token} ${drift < 0.008}`).toBe(`${hue} ${token} true`);
      }
    }
  });

  it('leaves the sheets, the workspaces and the meanings exactly as written', () => {
    for (const hue of SWEEP) {
      const palette = generatePalette('lightbox', hue);
      for (const token of Object.keys(REFERENCE_PALETTES.lightbox)) {
        if (LIGHTBOX_HUE_TOKENS.includes(token)) continue;
        expect(`${hue} ${token} ${palette[token]}`).toBe(
          `${hue} ${token} ${REFERENCE_PALETTES.lightbox[token]}`,
        );
      }
    }
  });

  it('turns the sheet outline with the bench and keeps it translucent', () => {
    // The outline is the line where a sheet ends and the bench begins, written
    // as the bench's own colour at 42%. Left behind it would draw a blue edge
    // round every card in a green room.
    for (const hue of SWEEP) {
      const outline = generatePalette('lightbox', hue)['--c-sheet-outline'];
      const parts = outline.match(/^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/);
      expect(`${hue} ${outline}`).toBe(`${hue} ${parts ? outline : 'unreadable'}`);
      expect(`${hue} alpha ${parts![4]}`).toBe(`${hue} alpha 0.42`);

      const hex = `#${[1, 2, 3]
        .map((at) => Number(parts![at]).toString(16).padStart(2, '0'))
        .join('')}`;
      // Fifteen degrees of the bench, which is as close as a colour this dark
      // gets to anything: the outline sits around 8% lightness, where a single
      // step of one channel is several degrees of hue. What the test is for is
      // that it moved at all.
      const bench = hexToOklch(generatePalette('lightbox', hue)['--c-page']);
      expect(`${hue} ${apart(hexToOklch(hex).h, bench.h) < 15}`).toBe(`${hue} true`);
    }
  });
});

describe('oklch', () => {
  it('round-trips every written colour without moving it', () => {
    for (const palette of Object.values(REFERENCE_PALETTES)) {
      for (const [token, value] of Object.entries(palette)) {
        // Lightbox writes its sheets with alpha, and a colour with alpha is not
        // one the generator reads at all.
        if (!HEX.test(value)) continue;
        expect(`${token} ${oklchToHex(hexToOklch(value))}`).toBe(`${token} ${value}`);
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
