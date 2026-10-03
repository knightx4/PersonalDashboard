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
  /**
   * A painted scene in place of the curtains: a file in public/sky/, drawn by
   * scripts/sky-art.ts. A sky with a scene shows the scene and none of the
   * ribbons or rays.
   */
  art?: string;
  /**
   * The brightest colours the scene paints over any area a card could sit on,
   * opaque. lib/theme/sky.test.ts measures the glass over every one of them,
   * the way it measures the ribbons' pools for the skies without a scene.
   */
  peaks?: readonly string[];
  /**
   * The glass, where a scene is bright enough to need a heavier pane than the
   * block's: a dusk horizon or the lower edge of an aurora is far brighter
   * than any pool. Flat `rgb(r g b / a)` values, like the block's own.
   */
  glass?: { surface: string; raised: string; canvas: string; sunken: string };
};

export type Sky = {
  id: SkyId;
  label: string;
  /** One line for the swatch's title, so it says what it is. */
  mood: string;
  /**
   * A sky has a night side, a dawn side, or both. The scenes that only make
   * sense in the dark -- a starfield, the northern lights -- have no dawn,
   * and the picker offers them only at night.
   */
  night?: SkySide;
  dawn?: SkySide;
};

export const SKY_IDS = [
  'borealis',
  'polar',
  'tide',
  'glacier',
  'nebula',
  'ember',
  'rose',
  'dunes',
  'silver',
  'starfield',
  'northern',
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
  {
    id: 'dunes',
    label: 'Dunes',
    mood: 'Sand under a low sun; a desert at dusk at night',
    night: {
      bench: '#1a1030',
      pools: { near: '#d8794f', mid: '#7a3a58', far: '#2a1640', floor: '#3a1d36' },
      accent: '#c9b2ff',
      accentHover: '#ddcbff',
      accentTint: '#2c1f45',
      art: '/sky/dunes-night.svg',
      peaks: ['#d8794f', '#e88a52', '#8a4a52', '#7a3a58'],
      glass: {
        surface: 'rgb(16 12 30 / 0.72)',
        raised: 'rgb(22 16 40 / 0.92)',
        canvas: 'rgb(8 6 18 / 0.62)',
        sunken: 'rgb(6 4 14 / 0.66)',
      },
    },
    dawn: {
      bench: '#f2c9b8',
      pools: { near: '#ffb38a', mid: '#e8956a', far: '#c9b7f0', floor: '#f6c99a' },
      accent: '#6a3d7a',
      accentHover: '#552f63',
      accentTint: '#f2e4f0',
      art: '/sky/dunes-dawn.svg',
      peaks: ['#b9a7f0', '#f0b8c8', '#ffd2a3', '#fff6d6', '#f9cf9c', '#eeb07c', '#d47a4d', '#a2583a'],
    },
  },
  {
    id: 'silver',
    label: 'Silver Dunes',
    mood: 'Pale sand and a cool sky; moonlit at night',
    night: {
      bench: '#0b1426',
      pools: { near: '#4a5f82', mid: '#2b4670', far: '#5a74a0', floor: '#1a2438' },
      accent: '#a9c8ff',
      accentHover: '#c4d9ff',
      accentTint: '#18263a',
      art: '/sky/silver-night.svg',
      peaks: ['#b8c6dc', '#5a74a0', '#4a5f82', '#2b4670'],
      glass: {
        surface: 'rgb(12 18 34 / 0.72)',
        raised: 'rgb(18 26 46 / 0.92)',
        canvas: 'rgb(6 10 22 / 0.72)',
        sunken: 'rgb(4 8 18 / 0.74)',
      },
    },
    dawn: {
      bench: '#e6ecf3',
      pools: { near: '#b9cbe0', mid: '#ddd5c6', far: '#a9c4e6', floor: '#efe9de' },
      accent: '#2c5592',
      accentHover: '#21447a',
      accentTint: '#e1e9f6',
      art: '/sky/silver-dawn.svg',
      peaks: ['#ffffff', '#a9c4e6', '#efe9de', '#c0b6a5', '#958e84'],
    },
  },
  {
    id: 'starfield',
    label: 'Starfield',
    mood: 'The Milky Way over a mountain ridge',
    night: {
      bench: '#03040a',
      pools: { near: '#9a98b4', mid: '#7d86ad', far: '#b8a48c', floor: '#16243a' },
      accent: '#b8c7ff',
      accentHover: '#d0daff',
      accentTint: '#1a2040',
      art: '/sky/starfield.svg',
      // The galaxy's glow at its warm core, which is the brightest area; a
      // star is a point and never sits under a whole line of text.
      peaks: ['#3a3640', '#2a2a35', '#16243a'],
    },
  },
  {
    id: 'northern',
    label: 'Northern Lights',
    mood: 'Green curtains of light over a line of pines',
    night: {
      bench: '#03070e',
      pools: { near: '#4dffa6', mid: '#1fc98a', far: '#b04fe0', floor: '#082430' },
      // Not green: green means saved here, and the sky is already green.
      accent: '#c9b5ff',
      accentHover: '#ddd0ff',
      accentTint: '#241d40',
      art: '/sky/northern.svg',
      peaks: ['#9ff0c4', '#4ce69a', '#1fc98a', '#3b6fd0'],
      glass: {
        surface: 'rgb(6 12 22 / 0.8)',
        raised: 'rgb(12 20 34 / 0.94)',
        canvas: 'rgb(4 8 16 / 0.7)',
        sunken: 'rgb(2 6 12 / 0.72)',
      },
    },
  },
];

/** Whether a sky can be shown in a polarity. */
export function hasSide(id: SkyId, polarity: SkyPolarity): boolean {
  return Boolean(skyById(id)?.[polarity]);
}

/**
 * The tokens a painted scene adds: the picture, and how the sky layer holds
 * it -- cover the screen from a little outside it, float rather than turn, no
 * rays -- plus a heavier pane where the scene needs one. None for the skies
 * that are ribbons, which the layer's own defaults already draw.
 */
function sceneTokens(side: SkySide): Record<string, string> {
  if (!side.art) return {};
  const glass: Record<string, string> = side.glass
    ? {
        '--c-surface': side.glass.surface,
        '--c-raised': side.glass.raised,
        '--c-canvas': side.glass.canvas,
        '--c-sunken': side.glass.sunken,
      }
    : {};
  return {
    '--sky-art': `url("${side.art}")`,
    '--sky-size': 'cover',
    '--sky-inset': '-3%',
    '--sky-anim': 'sky-float',
    '--sky-rest': 'none',
    '--sky-rays': '0',
    ...glass,
  };
}

/** The scene's own tokens, none of them `--c-*`, so applyTheme can clear them. */
export const SCENE_TOKENS: readonly string[] = [
  '--sky-art',
  '--sky-size',
  '--sky-inset',
  '--sky-anim',
  '--sky-rest',
  '--sky-rays',
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
  const side = sky?.[polarity];
  if (!side) return {};
  return {
    ...sceneTokens(side),
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
