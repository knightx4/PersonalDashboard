/**
 * A theme from a mode and a colour.
 *
 * The app used to offer four named themes; it now offers light or dark and a
 * hue, which is the same four themes and every other one. Picking a colour
 * moves the grounds, the text, the borders and the app's own accent to it and
 * leaves everything else -- the six workspace colours, green for saved, red
 * for delete -- where it was.
 *
 * The mechanism is a rotation in OKLCH. Each token of the reference palette is
 * read into a lightness, a chroma and a hue; the chroma stays as written, the
 * hue moves by the same number of degrees for every token so the distance
 * between the accent and the ground survives the move, and the lightness is
 * then nudged until the colour reflects as much light as the one it replaced.
 *
 * That last step is what makes a green theme exactly as readable as a plum
 * one rather than nearly as readable. Contrast is a function of relative
 * luminance, which weights green six times as heavily as blue, so holding
 * OKLCH lightness -- how light a colour looks -- lets the measured ratio
 * drift: a green link came out at 4.34:1 where the blue it replaced was 4.6:1.
 * Matching luminance on both sides of every pair means every ratio in a
 * generated palette is the ratio the reference had.
 *
 * No `server-only`: the layout writes the palette into the first byte and the
 * picker previews it under the cursor, so both sides need this.
 */
import { hexToOklch, relativeLuminance, withLuminance } from './oklch';
import {
  HUE_TOKENS,
  LIGHT_CAST,
  REFERENCE_HUE,
  REFERENCE_PALETTES,
  type Palette,
  type ThemeMode,
} from './reference';

export type { Palette, ThemeMode } from './reference';

const HUE_TOKEN_SET = new Set(HUE_TOKENS);

/**
 * Every `--c-*` colour token for one mode and one hue, as hex.
 *
 * A null hue is the reference itself, untouched: light is Paper and dark is
 * Ink, the two the app shipped with. A hue turns the cast reference for that
 * mode that many degrees around the circle, measured from the hue the
 * reference's own page ground carries.
 *
 * The cast reference is Dusk for dark and LIGHT_CAST for light -- Paper with
 * its accent moved onto Paper's own page hue, which is what #454 settled.
 * Paper's page and Paper's accent were chosen independently and sit a hundred
 * and eighty apart, so rotating Paper as one thing would answer a request for
 * green with a faintly green page and magenta links.
 *
 * `hue` is in degrees and may be anything; it is wrapped, so 400 is 40.
 */
export function generatePalette(mode: ThemeMode, hue: number | null): Palette {
  if (hue === null) {
    return { ...REFERENCE_PALETTES[mode === 'light' ? 'paper' : 'ink'] };
  }

  const name = mode === 'light' ? 'paper' : 'dusk';
  const reference = mode === 'light' ? LIGHT_CAST : REFERENCE_PALETTES.dusk;
  const turn = hue - REFERENCE_HUE[name];

  // Asking for the reference's own hue is the reference, said outright rather
  // than arrived at: Dusk has to come back hex for hex, and a bisection that
  // lands a ten-thousandth away from where it started could round otherwise.
  if (turn === 0) return { ...reference };

  return rotate(reference, turn);
}

/** Every token that takes the colour, turned, and every one that does not, kept. */
function rotate(reference: Palette, turn: number): Palette {
  const palette: Palette = {};
  for (const token of Object.keys(reference)) {
    const value = reference[token];
    if (!HUE_TOKEN_SET.has(token)) {
      palette[token] = value;
      continue;
    }
    const colour = hexToOklch(value);
    palette[token] = withLuminance({ ...colour, h: colour.h + turn }, relativeLuminance(value));
  }
  return palette;
}
