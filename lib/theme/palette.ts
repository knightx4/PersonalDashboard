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
  hueTokensFor,
  LIGHT_CAST,
  REFERENCE_HUE,
  REFERENCE_PALETTES,
  type Palette,
  type ThemeMode,
} from './reference';

export type { Palette, ThemeMode } from './reference';

/** The written palette a mode with no colour already is. */
const PLAIN: Record<ThemeMode, 'paper' | 'ink' | 'lightbox'> = {
  light: 'paper',
  dark: 'ink',
  lightbox: 'lightbox',
};

/** The palette a mode with a colour turns, and whose hue it turns from. */
const CAST: Record<ThemeMode, 'paper' | 'dusk' | 'lightbox'> = {
  light: 'paper',
  dark: 'dusk',
  lightbox: 'lightbox',
};

/**
 * Every `--c-*` colour token for one mode and one hue, as hex.
 *
 * A null hue is the reference itself, untouched: light is Paper, dark is Ink
 * and lightbox is Lightbox, the three the app shipped with. A hue turns the
 * cast reference for that mode that many degrees around the circle, measured
 * from the hue the reference's own page ground carries.
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
    return { ...REFERENCE_PALETTES[PLAIN[mode]] };
  }

  const reference = castFor(mode);
  const turn = hue - REFERENCE_HUE[CAST[mode]];

  // Asking for the reference's own hue is the reference, said outright rather
  // than arrived at: Dusk has to come back hex for hex, and a bisection that
  // lands a ten-thousandth away from where it started could round otherwise.
  if (turn === 0) return { ...reference };

  return rotate(reference, turn, hueTokensFor(mode));
}

/**
 * The palette a mode turns, already cast towards its own hue.
 *
 * Dark turns Dusk and light turns LIGHT_CAST, for the reasons in
 * lib/theme/reference.ts. Lightbox turns itself: its bench, its inks and its
 * borders were written on one hue to begin with, so it is already the shape
 * the other two had to be given.
 */
function castFor(mode: ThemeMode): Palette {
  return mode === 'light' ? LIGHT_CAST : REFERENCE_PALETTES[CAST[mode]];
}

/** Every token that takes the colour, turned, and every one that does not, kept. */
function rotate(reference: Palette, turn: number, tokens: readonly string[]): Palette {
  const turning = new Set(tokens);
  const palette: Palette = {};
  for (const token of Object.keys(reference)) {
    const value = reference[token];
    palette[token] = turning.has(token) ? turnColour(value, turn) : value;
  }
  return palette;
}

/** `rgb(r g b / a)`, which is how Lightbox writes the colours that are not flat. */
const RGB = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[/,]\s*([\d.]+)\s*)?\)$/i;

/**
 * One colour, moved `turn` degrees and held at the light it reflected.
 *
 * Hex is the ordinary case. The other is Lightbox's sheet outline, which is a
 * bench-coloured line at 42% alpha: it has to turn with the bench or a green
 * room ends up drawing every card with a blue edge. The alpha is carried
 * across untouched and the colour under it is turned like any other, which
 * works because what it composites onto -- the bench -- holds its luminance
 * through the same move.
 */
function turnColour(value: string, turn: number): string {
  const parts = value.match(RGB);
  if (!parts) return turnHex(value, turn);

  const channels = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const hex = `#${channels.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
  const turned = turnHex(hex, turn);
  const rgb = [1, 3, 5].map((at) => parseInt(turned.slice(at, at + 2), 16)).join(' ');
  return parts[4] === undefined ? `rgb(${rgb})` : `rgb(${rgb} / ${parts[4]})`;
}

function turnHex(value: string, turn: number): string {
  const colour = hexToOklch(value);
  return withLuminance({ ...colour, h: colour.h + turn }, relativeLuminance(value));
}
