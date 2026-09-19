/**
 * A theme from a mode and a colour.
 *
 * The app used to offer four named themes; it now offers light or dark and a
 * hue, which is the same four themes and every other one. Picking a colour
 * moves the grounds, the text, the borders and the app's own accent to it and
 * leaves everything else -- the six workspace colours, green for saved, red
 * for delete -- where it was. The one exception is a colour picked close to
 * one of those three: the accent steps a few degrees off it so a link never
 * comes out the same colour as the delete button, which is `accentHueFor`
 * below.
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
import {
  cuspOf,
  gamutChroma,
  hexToOklch,
  oklabDistance,
  oklchToHex,
  relativeLuminance,
  withLuminance,
} from './oklch';
import { colourwayById, paintsWash, POOL_TOKENS, type WashPools } from './colourway';
import {
  ACCENT_TOKENS,
  hueTokensFor,
  WASH_TOKENS,
  LIGHT_CAST,
  REFERENCE_HUE,
  REFERENCE_PALETTES,
  type Palette,
  type ThemeMode,
} from './reference';

export type { Palette, ThemeMode } from './reference';

/** The written palette a mode with no colour already is. */
const PLAIN: Record<ThemeMode, 'paper' | 'ink' | 'lightbox' | 'darkroom'> = {
  light: 'paper',
  dark: 'ink',
  lightbox: 'lightbox',
  darkroom: 'darkroom',
};

/** The palette a mode with a colour turns, and whose hue it turns from. */
const CAST: Record<ThemeMode, 'paper' | 'dusk' | 'lightbox' | 'darkroom'> = {
  light: 'paper',
  dark: 'dusk',
  lightbox: 'lightbox',
  // Its own, not Dusk's: a glass room turns a different token list and turns
  // it from its own bench, so borrowing the solid dark reference would rotate
  // the wrong things from the wrong place.
  darkroom: 'darkroom',
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
 * its accent moved onto Paper's own page hue, which is what #454 settled, and
 * its near-grey neutrals given enough chroma to read as a colour, which is
 * #456. Paper's page and Paper's accent were chosen independently and sit a
 * hundred and eighty apart, so rotating Paper as one thing would answer a
 * request for green with a faintly green page and magenta links.
 *
 * `hue` is in degrees and may be anything; it is wrapped, so 400 is 40.
 */
export function generatePalette(
  mode: ThemeMode,
  hue: number | null,
  way?: string | null,
): Palette {
  const base = generateBase(mode, hue);
  return way ? withColourway(base, mode, way) : base;
}

/**
 * The pools a named colourway asks for, in place of the turned ones.
 *
 * Only in a room that paints a wash. In Solid light and Solid dark
 * `--page-wash` is none, so the pools are never read, and writing a
 * colourway's magenta into a palette that will not paint it would leave the
 * tokens disagreeing with the screen for no gain.
 *
 * An unknown id is not an error. A stored theme naming a colourway that has
 * since been renamed should come back as the hue it was pointed at rather than
 * as nothing at all.
 */
function withColourway(base: Palette, mode: ThemeMode, id: string): Palette {
  const way = colourwayById(id);
  if (!way || !paintsWash(mode)) return base;

  const palette = { ...base };
  for (const slot of Object.keys(POOL_TOKENS) as (keyof WashPools)[]) {
    palette[POOL_TOKENS[slot]] = way.pools[slot];
  }
  return palette;
}

function generateBase(mode: ThemeMode, hue: number | null): Palette {
  if (hue === null) {
    return { ...REFERENCE_PALETTES[PLAIN[mode]] };
  }

  const reference = castFor(mode);
  const turn = hue - REFERENCE_HUE[CAST[mode]];
  const accentTurn = accentHueFor(mode, hue) - REFERENCE_HUE[CAST[mode]];

  // Asking for the reference's own hue is the reference, said outright rather
  // than arrived at: Dusk has to come back hex for hex, and a bisection that
  // lands a ten-thousandth away from where it started could round otherwise.
  if (turn === 0 && accentTurn === 0) return { ...reference };

  return rotate(reference, turn, accentTurn, hueTokensFor(mode));
}

/**
 * How far the app's accent has to stay from a colour that carries a meaning,
 * measured in OKLab.
 *
 * Red means delete, amber means attention and green means saved in every
 * theme, because #421 settled that those three do not move with the colour you
 * pick. Pick one of them and the links, the active state and the primary
 * button would come out wearing it; #469 settled that the accent is what gives
 * way. #493 settled that the test is how far apart the two look rather than
 * how many degrees apart they sit -- the collisions are in different places in
 * each mode, so no single angle is right in all three -- and #514 settled the
 * number. At 0.03 the accent moves for 17 hues of the 360 in light, 25 in dark
 * and 29 on Lightbox, by at most 15 degrees. The four written themes keep
 * their accent between 0.16 and 0.31 from all three.
 */
export const MEANING_FLOOR = 0.03;

/**
 * Each accent token with the meaning colours that land beside it.
 *
 * Two scopes, because Lightbox draws both polarities at once: the accent on a
 * card is measured against the card's red, amber and green, and the accent on
 * the bench against the bench's. In light and dark the two scopes hold the
 * same values and the second pass re-proves the first.
 */
export const MEANING_PAIRS: readonly (readonly [string, readonly string[]])[] = [
  ['--c-accent-base', ['--c-danger', '--c-caution', '--c-positive']],
  ['--c-accent-base-lit', ['--c-page-danger', '--c-page-caution', '--c-page-positive']],
];

/** Every accent-to-meaning distance in a palette, for whatever is measuring them. */
export function meaningGaps(palette: Palette): { accent: string; meaning: string; gap: number }[] {
  return MEANING_PAIRS.flatMap(([accent, meanings]) =>
    meanings.map((meaning) => ({
      accent,
      meaning,
      gap: oklabDistance(palette[accent], palette[meaning]),
    })),
  );
}

/**
 * The hue the links and the primary button actually take.
 *
 * The one that was asked for, everywhere the accent it produces is at least
 * `MEANING_FLOOR` from the delete red, the warning amber and the saved green
 * -- which is most of the circle. Inside one of the bands where it is not, the
 * accent steps to the nearest hue outside that band and the rest of the
 * palette stays exactly where it was pointed, so the page, the panels and the
 * borders are always the colour that was chosen.
 *
 * Nearest rather than always the same way round is #515's answer: every colour
 * moves as little as it can and nothing outside a band moves at all. The cost
 * it names is visible here -- dragging the strip through the middle of a band
 * jumps the links from one edge of it to the other, which is the one point
 * where both edges are equally wrong. A band whose two edges are exactly the
 * same distance away goes up, because it has to go one way.
 */
export function accentHueFor(mode: ThemeMode, hue: number): number {
  const reference = castFor(mode);
  if (gapAt(reference, mode, hue) >= MEANING_FLOOR) return hue;

  // A degree at a time, up the circle and down it. The widest band is 29 hues,
  // so this settles within 15 steps; the half-circle is a bound rather than a
  // case, and a floor high enough to reach it would have no hue left to move
  // to anyway.
  for (let step = 1; step <= 180; step += 1) {
    if (gapAt(reference, mode, hue + step) >= MEANING_FLOOR) return hue + step;
    if (gapAt(reference, mode, hue - step) >= MEANING_FLOOR) return hue - step;
  }
  return hue;
}

/**
 * What the smallest accent-to-meaning distance would be at one hue.
 *
 * The accent tokens alone, turned. The meaning colours do not move, so they
 * are read straight off the reference, and the other hundred tokens are not
 * generated at all -- this runs up to thirty times for a hue inside a band.
 */
function gapAt(reference: Palette, mode: ThemeMode, hue: number): number {
  const turning = new Set(hueTokensFor(mode));
  const turn = hue - REFERENCE_HUE[CAST[mode]];
  let smallest = Infinity;
  for (const [accent, meanings] of MEANING_PAIRS) {
    const value = turning.has(accent) ? turnColour(reference[accent], turn) : reference[accent];
    for (const meaning of meanings) {
      smallest = Math.min(smallest, oklabDistance(value, reference[meaning]));
    }
  }
  return smallest;
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

/**
 * Every token that takes the colour, turned, and every one that does not, kept.
 *
 * Two turns rather than one: the accent family takes `accentTurn`, which is
 * the same as `turn` except where the chosen colour is too close to red, amber
 * or green, and everything else takes `turn`.
 */
function rotate(
  reference: Palette,
  turn: number,
  accentTurn: number,
  tokens: readonly string[],
): Palette {
  const turning = new Set(tokens);
  const accents = new Set(ACCENT_TOKENS);
  const wash = new Set(WASH_TOKENS);
  const palette: Palette = {};
  for (const token of Object.keys(reference)) {
    const value = reference[token];
    if (!turning.has(token)) {
      palette[token] = value;
      continue;
    }
    palette[token] = wash.has(token)
      ? turnWash(value, turn)
      : turnColour(value, accents.has(token) ? accentTurn : turn);
  }
  return palette;
}

/**
 * One of the bench's pools, moved `turn` degrees to a colour as good as the
 * one it replaced.
 *
 * Not `turnColour`, and the difference is the whole of #529. Every other token
 * is rotated at the light it was reflecting, because the contrast the app has
 * is a function of luminance and holding it is what makes a generated theme as
 * readable as the written one. A pool reflects light at nothing: it is a
 * decoration five layers behind the nearest word. Holding it to the luminance
 * of a blue is a constraint it was never owed, and it is what made every warm
 * room brown -- a blue sits at a tenth of the light a screen can throw, and a
 * yellow forced down to a tenth is not a yellow, it is olive. The screenshots
 * that started this showed an orange room and a green-gold one, both mud.
 *
 * So a pool turns on the two things that actually decide whether a colour
 * looks like itself:
 *
 * Its lightness follows its hue. Every hue is most colourful at its own
 * lightness -- blue near L 0.45, yellow near L 0.93 -- and `cuspOf` says
 * where. The pool moves seven tenths of the way from where its old hue peaked
 * to where its new one does, which is enough to lift a yellow out of the brown
 * and not so much that a sweep loses the shape it was drawn with. All the way
 * flattens it: the pools converge on one lightness and the wash goes grey.
 *
 * Its chroma is whatever the screen can still show there. A pool is seen
 * through a 26-to-34 percent mix over a near-black bench, so a third of its
 * colour is all that survives to the glass; sitting on the gamut edge is what
 * keeps a red room red rather than dust. The old code held the chroma number
 * instead, which reads as vivid at blue -- where sRGB is generous -- and as
 * grey at gold, where it is not.
 *
 * Identity at `turn` 0, so the wheel is smooth: no move, no new cusp, no
 * change. The written palettes are left as they are and are a little softer
 * than what this generates beside them, which is deliberate -- they were
 * chosen by eye rather than derived, and that is the one palette nobody
 * complained about.
 */
function turnWash(value: string, turn: number): string {
  const from = hexToOklch(value);
  const h = from.h + turn;
  const lifted = Math.min(
    0.92,
    Math.max(0.08, from.l + CUSP_FOLLOW * (cuspOf(h).l - cuspOf(from.h).l)),
  );
  const l = capped(lifted, h, relativeLuminance(value) * WASH_LIGHT_BUDGET);
  return oklchToHex({ l, c: gamutChroma(l, h), h });
}

/** How much of the way a pool's lightness moves to where its new hue peaks. */
const CUSP_FOLLOW = 0.7;

/**
 * How much more light a turned pool may throw than the one it came from.
 *
 * Lifting a pool onto its hue's cusp is what takes the brown out of a warm
 * room, and it is also the one thing in the wash that can cost readability:
 * the bench carries the sidebar's text, a sheet is a fifth bench, and every
 * layer of the wash only adds light, so a brighter pool closes the gap between
 * the bench and the pale ink on it. Left unbounded the lift nearly triples the
 * light at the brightest point of the field -- measured, 0.15 to 0.41 -- and
 * takes eighteen more pairs under 4.5:1 with it.
 *
 * A quarter more than the written pool buys most of the colour back and costs
 * a fifth of that: the field peaks at 0.19 against today's 0.15. Which is a
 * real cost and not nothing, so it is written here as one number with its
 * reasoning rather than buried in a bisection.
 */
const WASH_LIGHT_BUDGET = 1.3;

/**
 * The highest lightness at or below `l` whose colour reflects no more than
 * `budget`, at this hue and on the gamut edge.
 *
 * Luminance rises with lightness along the edge, so a bisection finds it.
 * Returns `l` untouched when it already fits, which is most of the circle --
 * only the yellows and greens lift far enough to hit the ceiling.
 */
function capped(l: number, h: number, budget: number): number {
  const lightAt = (at: number) => relativeLuminance(oklchToHex({ l: at, c: gamutChroma(at, h), h }));
  if (lightAt(l) <= budget) return l;
  let low = 0;
  let high = l;
  for (let step = 0; step < 20; step += 1) {
    const middle = (low + high) / 2;
    if (lightAt(middle) < budget) low = middle;
    else high = middle;
  }
  return low;
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
