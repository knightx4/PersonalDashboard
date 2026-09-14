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
 * read into a lightness, a chroma and a hue; the lightness and the chroma stay
 * exactly as written, and the hue moves by the same number of degrees for
 * every token, so the distance between the accent and the ground survives the
 * move. Lightness is what every contrast ratio in the app is a function of, so
 * holding it fixed is what makes a green theme as readable as a plum one.
 *
 * No `server-only`: the layout writes the palette into the first byte and the
 * picker previews it under the cursor, so both sides need this.
 */
import { hexToOklch, oklchToHex } from './oklch';
import {
  HUE_TOKENS,
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
 * Dark is finished. Light with a hue rotates Paper, which is not yet the right
 * answer -- Paper's accent sits opposite its page, so it turns the wrong way --
 * and waits on plan #454.
 *
 * `hue` is in degrees and may be anything; it is wrapped, so 400 is 40.
 */
export function generatePalette(mode: ThemeMode, hue: number | null): Palette {
  if (hue === null) {
    return { ...REFERENCE_PALETTES[mode === 'light' ? 'paper' : 'ink'] };
  }

  const name = mode === 'light' ? 'paper' : 'dusk';
  const reference = REFERENCE_PALETTES[name];
  const turn = hue - REFERENCE_HUE[name];

  const palette: Palette = {};
  for (const token of Object.keys(reference)) {
    const value = reference[token];
    if (!HUE_TOKEN_SET.has(token)) {
      palette[token] = value;
      continue;
    }
    const colour = hexToOklch(value);
    palette[token] = oklchToHex({ ...colour, h: colour.h + turn });
  }
  return palette;
}
