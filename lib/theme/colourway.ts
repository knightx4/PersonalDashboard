/**
 * The colourways the picker offers, written out rather than derived.
 *
 * A colourway is a bench hue and the four pools the wash is painted from. The
 * hue does what it always did: it turns the bench, the text on it, the borders
 * and the app's accent, so a colourway is as readable as the palette it was
 * generated from. The pools are the new part. They used to be the reference
 * sweep turned to the hue, which meant every preset was the same three steps
 * of the circle wearing a different coat, and picking green gave you the blue
 * room's shape in green.
 *
 * Written out means each one can be its own thing. Midnight, Moss and Clay
 * hold a single colour and get their depth from lightness. Periwinkle runs
 * blue into violet, which is two neighbours. Ember, Prism and Opal carry three
 * or four colours that are nowhere near each other on the circle. None of that
 * is expressible as "rotate this by N degrees", which is why it is a table.
 *
 * The free hue strip is unchanged and still rotates the reference sweep. These
 * sit in front of it as the presets, the way they did when they were five
 * angles.
 *
 * Only the glass rooms paint a wash, so in Solid light and Solid dark a
 * colourway is its hue and nothing else -- the same theme the hue alone would
 * have given.
 */
import type { ThemeMode } from './reference';

/** Where each pool sits, which is what the names in `--page-wash` mean.
 *
 *   near   top left, the largest pool
 *   far    top right
 *   mid    right of centre
 *   floor  along the bottom
 */
export type WashPools = {
  near: string;
  mid: string;
  far: string;
  floor: string;
};

export type Colourway = {
  id: string;
  label: string;
  /** One line for the title attribute, so the swatch says what it is. */
  mood: string;
  /** What the rest of the palette turns to. */
  hue: number;
  /**
   * How much of each pool reaches the bench, against the percentages written
   * into `--page-wash`. One is those percentages; 1.5 is half as much again.
   *
   * It exists because the pools are seen through a 26-to-34 percent mix over a
   * near-black bench, so roughly a third of a pool survives to the glass, and
   * a third of a deep magenta is not magenta. Raising the mix is a better buy
   * than lightening the pool: it carries the chroma up with it, where a
   * lighter pool loses chroma as it approaches the top of the gamut.
   *
   * Set per colourway rather than once, because what it costs depends on how
   * light the pools already are. Each of these was measured -- the wash
   * rendered by the browser at every hue, the brightest pixel of the field
   * read back -- and the number chosen so the peak lands at or under 0.150,
   * which is what the free-hue wash already spends. Ember carries 1.8 and
   * still peaks at 0.126, because its pools are deep; Opal carries 1.1 and
   * peaks at 0.148, because its pools are already bright.
   *
   * `peak` below records what came back, and the test holds it against the
   * budget.
   */
  lift: number;
  /**
   * The brightest pixel this colourway's wash paints, as WCAG relative
   * luminance, measured rather than derived.
   *
   * It is here because no arithmetic stands in for it. The pools sit in
   * different corners with different falloffs, so what any point receives
   * depends on the geometry: stacking all seven layers puts Ember at 0.211 and
   * the browser puts it at 0.126, and the two models do not even rank the
   * seven the same way. The number is what a render says, and nothing in the
   * test suite can recompute it.
   *
   * How it was taken: paint `--page-wash` over the colourway's bench at
   * 240x150 in headless Chromium, read every pixel back through a canvas, keep
   * the largest 0.2126R + 0.7152G + 0.0722B. The free-hue wash measured the
   * same way peaks at 0.152, and that is the budget every colourway is held
   * to in colourway.test.ts.
   *
   * Editing a pool or a lift without re-measuring leaves this stale, and the
   * test will not catch it -- it can only check the number against the budget,
   * not against the colour. Re-measure.
   */
  peak: number;
  pools: WashPools;
};

export const COLOURWAYS: readonly Colourway[] = [
  {
    id: 'periwinkle',
    label: 'Periwinkle',
    mood: 'Blue into violet',
    hue: 265,
    lift: 1.5,
    peak: 0.148,
    pools: { near: '#597bff', mid: '#8c56ff', far: '#c182ff', floor: '#3300aa' },
  },
  {
    id: 'midnight',
    label: 'Midnight',
    mood: 'Deep blue, one colour',
    hue: 245,
    lift: 1.2,
    peak: 0.15,
    pools: { near: '#0040ea', mid: '#006f97', far: '#01d5ea', floor: '#06006c' },
  },
  {
    id: 'ember',
    label: 'Ember',
    mood: 'Magenta, purple, a low orange',
    hue: 330,
    lift: 1.8,
    peak: 0.126,
    pools: { near: '#f50079', mid: '#8f00d3', far: '#5e00a1', floor: '#fe8800' },
  },
  {
    id: 'prism',
    label: 'Prism',
    mood: 'Coral, teal and blue',
    hue: 230,
    lift: 1.15,
    peak: 0.147,
    pools: { near: '#ff6d5c', mid: '#00b8d5', far: '#00c6a8', floor: '#0800cb' },
  },
  {
    id: 'opal',
    label: 'Opal',
    mood: 'Pink, lavender and cyan',
    hue: 300,
    lift: 1.1,
    peak: 0.148,
    pools: { near: '#ff63dd', mid: '#a889ff', far: '#00d9f6', floor: '#6f47ff' },
  },
  {
    id: 'moss',
    label: 'Moss',
    mood: 'Green, one colour',
    hue: 152,
    lift: 1.2,
    peak: 0.148,
    pools: { near: '#00a94e', mid: '#00813a', far: '#8ed100', floor: '#003f1e' },
  },
  {
    id: 'clay',
    label: 'Clay',
    mood: 'Rust into amber',
    hue: 40,
    lift: 1.3,
    peak: 0.15,
    pools: { near: '#f15d00', mid: '#b73600', far: '#f8a700', floor: '#641c00' },
  },
];

export type ColourwayId = (typeof COLOURWAYS)[number]['id'];

/** The token each pool is written to, which is what the generator overwrites. */
export const POOL_TOKENS: Readonly<Record<keyof WashPools, string>> = {
  near: '--c-wash-near',
  mid: '--c-wash-mid',
  far: '--c-wash-far',
  floor: '--c-wash-floor',
};

/**
 * The brightest pixel the free-hue wash paints, measured the same way as
 * `peak`. Every colourway is held at or under it.
 */
export const WASH_PEAK_BUDGET = 0.152;

/** The custom property the wash multiplies its mix percentages by. */
export const WASH_LIFT = '--wash-lift';

export function colourwayById(id: string | null | undefined): Colourway | undefined {
  return COLOURWAYS.find((way) => way.id === id);
}

/** Whether a room paints a wash at all. The solid two paint none. */
export function paintsWash(mode: ThemeMode): boolean {
  return mode === 'lightbox' || mode === 'darkroom';
}
