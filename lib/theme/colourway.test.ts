import { describe, expect, it } from 'vitest';
import { formatTheme, parseTheme, type Theme } from '@/lib/theme';
import {
  COLOURWAYS,
  POOL_TOKENS,
  WASH_PEAK_BUDGET,
  type Colourway,
} from '@/lib/theme/colourway';
import { generatePalette } from '@/lib/theme/palette';
import { REFERENCE_HUE, REFERENCE_PALETTES, WASH_TOKENS } from '@/lib/theme/reference';

const HEX = /^#[0-9a-f]{6}$/i;

describe('colourways', () => {
  it('writes four pools and a bench hue, all of them usable', () => {
    for (const way of COLOURWAYS) {
      expect(`${way.id} hue ${Number.isInteger(way.hue) && way.hue >= 0 && way.hue < 360}`).toBe(
        `${way.id} hue true`,
      );
      for (const slot of Object.keys(POOL_TOKENS) as (keyof Colourway['pools'])[]) {
        expect(`${way.id} ${slot} ${HEX.test(way.pools[slot])}`).toBe(`${way.id} ${slot} true`);
      }
    }
  });

  it('gives every colourway a name of its own', () => {
    const ids = COLOURWAYS.map((way) => way.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('keeps each lift below the point where a pool stops being a wash', () => {
    // The largest mix in the stack is 34%, and above 100% a pool is an opaque
    // fill: it covers the three behind it and a four-colour colourway comes
    // back as one flat square. That is what the chips in the picker did before
    // their lift was made flat rather than a multiple of this one.
    for (const way of COLOURWAYS) {
      expect(`${way.id} ${way.lift * 0.34 < 1}`).toBe(`${way.id} true`);
    }
  });

  it('spends no more light than the wash a free hue already paints', () => {
    // Against the recorded measurement, not against arithmetic. No sum of the
    // layers stands in for the render: they sit in different corners with
    // different falloffs, so stacking all seven puts Ember highest of the
    // seven when the browser puts it lowest. What this holds is that the
    // number somebody wrote down after measuring is inside the budget. It
    // cannot tell whether that number still describes the pools above it --
    // see `peak` in ./colourway.ts for how to take it again.
    for (const way of COLOURWAYS) {
      expect(`${way.id} ${way.peak <= WASH_PEAK_BUDGET}`).toBe(`${way.id} true`);
    }
  });

  it('puts its pools into a glass room and leaves the rest of the palette alone', () => {
    for (const way of COLOURWAYS) {
      for (const mode of ['lightbox', 'darkroom'] as const) {
        const plain = generatePalette(mode, way.hue);
        const painted = generatePalette(mode, way.hue, way.id);
        for (const token of Object.keys(plain)) {
          const expected = WASH_TOKENS.includes(token)
            ? way.pools[
                (Object.keys(POOL_TOKENS) as (keyof Colourway['pools'])[]).find(
                  (slot) => POOL_TOKENS[slot] === token,
                )!
              ]
            : plain[token];
          expect(`${way.id} ${mode} ${token} ${painted[token]}`).toBe(
            `${way.id} ${mode} ${token} ${expected}`,
          );
        }
      }
    }
  });

  it('leaves a solid room exactly as its hue alone would', () => {
    // Solid light and Solid dark paint no wash, so a colourway there is its
    // hue and nothing else. Writing the pools anyway would leave the tokens
    // describing a room that is not on the screen.
    for (const way of COLOURWAYS) {
      for (const mode of ['light', 'dark'] as const) {
        expect(generatePalette(mode, way.hue, way.id)).toEqual(generatePalette(mode, way.hue));
      }
    }
  });

  it('stores a colourway by name and reads it back whole', () => {
    for (const way of COLOURWAYS) {
      for (const mode of ['lightbox', 'darkroom', 'light', 'dark'] as const) {
        const theme: Theme = { kind: 'generated', mode, hue: way.hue, way: way.id };
        const stored = formatTheme(theme);
        expect(stored).toBe(`${mode}:${way.id}`);
        expect(parseTheme(stored)).toEqual(theme);
      }
    }
  });

  it('still reads back every theme string that was stored as a number', () => {
    // The colourways took a slot that used to hold only degrees, so an account
    // holding `lightbox:260` has to keep meaning 260 degrees.
    for (const hue of [0, 25, 155, 260, 359]) {
      expect(parseTheme(`lightbox:${hue}`)).toEqual({
        kind: 'generated',
        mode: 'lightbox',
        hue,
      });
    }
    // A mode with no colour and the written theme of that name are one string
    // and read back as the written one, which lib/theme.ts settled long before
    // colourways existed.
    expect(parseTheme('darkroom')).toEqual({ kind: 'written', id: 'darkroom' });
  });

  it('falls back to a hue when a stored colourway no longer exists', () => {
    // A renamed or dropped colourway should not log somebody out of their
    // theme. `generatePalette` ignores the name and the room stays the colour
    // it was pointed at.
    expect(parseTheme('lightbox:sunset')).toEqual({ kind: 'system' });
    const palette = generatePalette('lightbox', REFERENCE_HUE.lightbox, 'sunset');
    for (const token of WASH_TOKENS) {
      expect(`${token} ${palette[token]}`).toBe(
        `${token} ${REFERENCE_PALETTES.lightbox[token]}`,
      );
    }
  });
});
