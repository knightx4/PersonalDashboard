/**
 * Aurora's skies: the named colour variations of the Aurora and Dawn themes.
 *
 * Aurora is glass laid over a sky of light. The theme blocks in
 * app/globals.css write everything the glass is made of -- the inks, the
 * sheets, the workspace colours, the meanings -- and they write the default
 * sky, Borealis. A sky is the part a person gets to choose: the bench colour,
 * the four pools the wash is painted from, and the accent that goes with them.
 *
 * Written out by hand rather than turned from a hue, for the reason the
 * colourways give in lib/theme/colourway.ts: a good sky is a few colours that
 * belong together, and Polar's green into teal into violet is not any other
 * sky rotated. Each one has a night side and a dawn side, chosen together, so
 * switching polarity keeps the sky recognisably itself.
 *
 * Every value here is held by tests: lib/theme/sky.test.ts measures each
 * accent over every glass ground, over the bench and over the brightest point
 * of each pool, and keeps it clear of the red, amber and green that carry a
 * meaning; scripts/check-contrast.ts measures each sky as a whole theme.
 *
 * No `server-only`: the layout writes a sky into the first byte and the picker
 * draws the swatches, so both sides need this.
 */
import type { WashPools } from './colourway';

export type SkyPolarity = 'night' | 'dawn';

/** One side of a sky: what changes on the theme block when it is chosen. */
export type SkySide = {
  /** The page ground and the sidebar's: one bench, as in the glass rooms. */
  bench: string;
  pools: WashPools;
  accent: string;
  accentHover: string;
  /** The ground behind accent text: a selected row, an accent chip. */
  accentTint: string;
};

export type Sky = {
  id: SkyId;
  label: string;
  /** One line for the swatch's title, so it says what it is. */
  mood: string;
  night: SkySide;
  dawn: SkySide;
};

export const SKY_IDS = [
  'borealis',
  'polar',
  'tide',
  'glacier',
  'nebula',
  'ember',
  'rose',
] as const;

export type SkyId = (typeof SKY_IDS)[number];

/** The sky the theme blocks are written in. Choosing it writes no tokens. */
export const DEFAULT_SKY: SkyId = 'borealis';

export const SKIES: readonly Sky[] = [
  {
    id: 'borealis',
    label: 'Borealis',
    mood: "Blue, violet and pink: the app mark's own colours",
    night: {
      bench: '#0c1022',
      pools: { near: '#5b7cff', mid: '#8b5cf6', far: '#ff6b9d', floor: '#2a2fd0' },
      accent: '#aab6ff',
      accentHover: '#c3ccff',
      accentTint: '#1c2147',
    },
    dawn: {
      bench: '#e6eaf6',
      pools: { near: '#7d95ff', mid: '#b48cff', far: '#ff8fb8', floor: '#8fb0ff' },
      accent: '#3346b8',
      accentHover: '#26348f',
      accentTint: '#e1e6fb',
    },
  },
  {
    id: 'polar',
    label: 'Polar',
    mood: 'Green into teal into violet, the way the real thing looks',
    night: {
      bench: '#06141a',
      pools: { near: '#1fd18a', mid: '#18b6c8', far: '#7a5cff', floor: '#0e6a5a' },
      accent: '#86d8ff',
      accentHover: '#a8e4ff',
      accentTint: '#0f2a38',
    },
    dawn: {
      bench: '#e3f0ef',
      pools: { near: '#5be3aa', mid: '#62cfe2', far: '#a58cff', floor: '#86dcc6' },
      accent: '#0b5a96',
      accentHover: '#084a7c',
      accentTint: '#dcf0f7',
    },
  },
  {
    id: 'tide',
    label: 'Tide',
    mood: 'Cobalt, cyan and sea-glass',
    night: {
      bench: '#051526',
      pools: { near: '#1e6bff', mid: '#00c2e0', far: '#3fe0c5', floor: '#0a2e8a' },
      accent: '#7fd0ff',
      accentHover: '#a3ddff',
      accentTint: '#0d2640',
    },
    dawn: {
      bench: '#e2eef6',
      pools: { near: '#6aa0ff', mid: '#5fd6ea', far: '#7fe8d4', floor: '#8fb6ff' },
      accent: '#0a58a6',
      accentHover: '#084684',
      accentTint: '#dcebfa',
    },
  },
  {
    id: 'glacier',
    label: 'Glacier',
    mood: 'Pale steel and ice. The quietest sky',
    night: {
      bench: '#0b121c',
      pools: { near: '#5f8fc4', mid: '#93acd8', far: '#bfd0ff', floor: '#24426e' },
      accent: '#a9c8ff',
      accentHover: '#c4d9ff',
      accentTint: '#18263a',
    },
    dawn: {
      bench: '#e8edf4',
      pools: { near: '#9fbde6', mid: '#c2d0ef', far: '#dbe4ff', floor: '#adc4e4' },
      accent: '#2c5592',
      accentHover: '#21447a',
      accentTint: '#e1e9f6',
    },
  },
  {
    id: 'nebula',
    label: 'Nebula',
    mood: 'Deep violet and magenta',
    night: {
      bench: '#100a22',
      pools: { near: '#7b3cff', mid: '#d14bff', far: '#3a5bff', floor: '#3a0f8a' },
      accent: '#cdb2ff',
      accentHover: '#ddc8ff',
      accentTint: '#241a44',
    },
    dawn: {
      bench: '#ebe8f7',
      pools: { near: '#a98bff', mid: '#e59bff', far: '#8fa6ff', floor: '#c4b0ff' },
      accent: '#5a2fc0',
      accentHover: '#47249c',
      accentTint: '#ebe3fb',
    },
  },
  {
    id: 'ember',
    label: 'Ember',
    mood: 'Magenta, violet and a low orange sun',
    night: {
      bench: '#160b1a',
      pools: { near: '#ff4f8b', mid: '#b23cff', far: '#ff9a3c', floor: '#7a1f6b' },
      accent: '#f6a8ff',
      accentHover: '#fbc4ff',
      accentTint: '#2e1638',
    },
    dawn: {
      bench: '#f4e8ee',
      pools: { near: '#ff7aa6', mid: '#c98bff', far: '#ffb366', floor: '#ff9ec0' },
      accent: '#8a2a9e',
      accentHover: '#6f1f80',
      accentTint: '#f7e2f7',
    },
  },
  {
    id: 'rose',
    label: 'Rose',
    mood: 'Rose, peach and lilac',
    night: {
      bench: '#160d18',
      pools: { near: '#ff6f91', mid: '#ffa77a', far: '#c58bff', floor: '#5a1f5a' },
      accent: '#f2b3ff',
      accentHover: '#f8cbff',
      accentTint: '#2f1a36',
    },
    dawn: {
      bench: '#f5eaee',
      pools: { near: '#ffa0b5', mid: '#ffc39e', far: '#d9b3ff', floor: '#ffb8c8' },
      accent: '#8b2f8f',
      accentHover: '#702473',
      accentTint: '#f6e3f4',
    },
  },
];

export function isSkyId(value: string | null | undefined): value is SkyId {
  return SKY_IDS.some((id) => id === value);
}

export function skyById(id: string | null | undefined): Sky | undefined {
  return SKIES.find((sky) => sky.id === id);
}

/**
 * The `--c-*` tokens a sky writes over its theme block.
 *
 * Empty for the default sky, because the block already says it. The accent
 * goes into both scopes -- `-lit` is the page's copy -- since Aurora's page
 * and sheets share a polarity and the two have to agree.
 */
export function skyTokens(polarity: SkyPolarity, id: SkyId): Record<string, string> {
  if (id === DEFAULT_SKY) return {};
  const sky = skyById(id);
  if (!sky) return {};
  const side = sky[polarity];
  return {
    '--c-page-ground': side.bench,
    '--c-page': side.bench,
    '--c-shell': side.bench,
    '--c-wash-near': side.pools.near,
    '--c-wash-mid': side.pools.mid,
    '--c-wash-far': side.pools.far,
    '--c-wash-floor': side.pools.floor,
    '--c-accent-base': side.accent,
    '--c-accent-hover': side.accentHover,
    '--c-accent-tint-base': side.accentTint,
    '--c-accent-base-lit': side.accent,
    '--c-accent-hover-lit': side.accentHover,
  };
}
