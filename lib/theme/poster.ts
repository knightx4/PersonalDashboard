/**
 * Lightbox's palettes.
 *
 * Lightbox is a printed poster: paper, one ink for every outline and hard
 * shadow, a dark sidebar, and a solid band of colour across the top of every
 * titled card, cycling through three colours. Nothing is translucent. The
 * theme block in app/globals.css (`[data-theme='poster']`) writes Primary,
 * and the shapes -- the outline, the shadow, the bands -- are rules in the
 * same file that read the tokens below.
 *
 * A palette is the whole set of colours, written by hand: the same reason the
 * colourways and Aurora's skies are written rather than turned from a hue. A
 * poster palette is three band colours, an ink and a paper that were chosen
 * together, and a rotation of red, blue and yellow does not produce teal,
 * mustard and burnt orange.
 *
 * Every palette is measured as a whole theme by scripts/check-contrast.ts and
 * by lib/theme/poster.test.ts, which also measures each band's label on its
 * band.
 */

export const PALETTE_IDS = [
  'primary',
  'midcentury',
  'navy',
  'slate',
  'ocean',
  'nordic',
  'plum',
] as const;

export type PaletteId = (typeof PALETTE_IDS)[number];

/** The palette the theme block is written in. Choosing it writes no tokens. */
export const DEFAULT_PALETTE: PaletteId = 'primary';

export type Palette = {
  id: PaletteId;
  label: string;
  mood: string;
  /** The page ground. */
  paper: string;
  /** A card, a menu, a raised panel. */
  card: string;
  /** A well inside a card, and the sunken ground. */
  well: string;
  /** Hairlines between rows. */
  line: string;
  /** Text, every outline, every hard shadow, and control borders. */
  ink: string;
  muted: string;
  /** Decoration only: placeholders, disabled labels. */
  ghost: string;
  side: string;
  sideText: string;
  sideMuted: string;
  sideHover: string;
  /** The three header bands, in the order cards cycle through them, each with the ink its label takes. */
  bands: readonly [Band, Band, Band];
  /** The current page in the sidebar, and the count badges. */
  highlight: Band;
  /** Links and the primary button. */
  link: string;
  linkHover: string;
  /** The ground behind accent text: a selected row, an accent chip. */
  linkTint: string;
  /** The label on a primary button. */
  onLink: string;
};

export type Band = { fill: string; ink: string };

export const PALETTES: readonly Palette[] = [
  {
    id: 'primary',
    label: 'Primary',
    mood: 'Blue, yellow and red with black ink on oat paper',
    paper: '#f3efe6',
    card: '#ffffff',
    well: '#f7f4ec',
    line: '#e7e1d5',
    ink: '#111111',
    muted: '#4f4b45',
    ghost: '#77726a',
    side: '#111111',
    sideText: '#f7f3ea',
    sideMuted: '#b3ada2',
    sideHover: '#262626',
    bands: [
      { fill: '#1f4bd8', ink: '#ffffff' },
      { fill: '#f4c430', ink: '#111111' },
      { fill: '#db2e1f', ink: '#ffffff' },
    ],
    highlight: { fill: '#f4c430', ink: '#111111' },
    link: '#1f4bd8',
    linkHover: '#1739a8',
    linkTint: '#e3e9fb',
    onLink: '#ffffff',
  },
  {
    id: 'midcentury',
    label: 'Mid-century',
    mood: 'Teal, mustard and burnt orange with brown ink on cream',
    paper: '#f2e8d5',
    card: '#fffaf0',
    well: '#f8f0e0',
    line: '#eadfc9',
    ink: '#3b2516',
    muted: '#664a35',
    ghost: '#8c7560',
    side: '#3b2516',
    sideText: '#f7ecd8',
    sideMuted: '#cdb79c',
    sideHover: '#4d3324',
    bands: [
      { fill: '#1f6f6b', ink: '#ffffff' },
      { fill: '#e3a72f', ink: '#3b2516' },
      { fill: '#b94a19', ink: '#ffffff' },
    ],
    highlight: { fill: '#e3a72f', ink: '#3b2516' },
    link: '#1f6f6b',
    linkHover: '#175753',
    linkTint: '#dcefec',
    onLink: '#ffffff',
  },
  {
    id: 'navy',
    label: 'Navy',
    mood: 'Navy ink with cornflower, sun and brick',
    paper: '#eef2f8',
    card: '#ffffff',
    well: '#f5f8fc',
    line: '#dfe6f0',
    ink: '#14244a',
    muted: '#44557a',
    ghost: '#6b7a99',
    side: '#14244a',
    sideText: '#eef2f8',
    sideMuted: '#aebbd6',
    sideHover: '#1f3260',
    bands: [
      { fill: '#2f6db5', ink: '#ffffff' },
      { fill: '#f2c14e', ink: '#14244a' },
      { fill: '#c44a39', ink: '#ffffff' },
    ],
    highlight: { fill: '#f2c14e', ink: '#14244a' },
    link: '#1d5fc4',
    linkHover: '#164c9e',
    linkTint: '#e3edf9',
    onLink: '#ffffff',
  },
  {
    id: 'slate',
    label: 'Slate',
    mood: 'Slate blue, honey and clay with charcoal ink',
    paper: '#eceef1',
    card: '#ffffff',
    well: '#f5f6f8',
    line: '#e1e4e9',
    ink: '#1c2330',
    muted: '#4b5466',
    ghost: '#737c8c',
    side: '#1c2330',
    sideText: '#eef0f4',
    sideMuted: '#a9b1c0',
    sideHover: '#283142',
    bands: [
      { fill: '#3d5a80', ink: '#ffffff' },
      { fill: '#e0b25c', ink: '#1c2330' },
      { fill: '#b5543c', ink: '#ffffff' },
    ],
    highlight: { fill: '#e0b25c', ink: '#1c2330' },
    link: '#3d5a80',
    linkHover: '#2e4563',
    linkTint: '#e2e8f0',
    onLink: '#ffffff',
  },
  {
    id: 'ocean',
    label: 'Ocean',
    mood: 'Deep teal, saffron and coral with sea-ink',
    paper: '#e8f0ef',
    card: '#ffffff',
    well: '#f3f8f7',
    line: '#dbe6e4',
    ink: '#0f2c33',
    muted: '#3f5c62',
    ghost: '#6b8489',
    side: '#0f2c33',
    sideText: '#e8f0ef',
    sideMuted: '#a6c1c3',
    sideHover: '#19404a',
    bands: [
      { fill: '#1b6f86', ink: '#ffffff' },
      { fill: '#e9c46a', ink: '#0f2c33' },
      { fill: '#dc7055', ink: '#0f2c33' },
    ],
    highlight: { fill: '#e9c46a', ink: '#0f2c33' },
    link: '#1b6f86',
    linkHover: '#145668',
    linkTint: '#dcedf0',
    onLink: '#ffffff',
  },
  {
    id: 'nordic',
    label: 'Nordic',
    mood: 'Forest, sand and berry, quiet and earthy',
    paper: '#ece8de',
    card: '#fbf9f4',
    well: '#f4f1ea',
    line: '#e3ddd0',
    ink: '#1d2a24',
    muted: '#4d5a52',
    ghost: '#78827b',
    side: '#24392f',
    sideText: '#ece8de',
    sideMuted: '#b5c2b9',
    sideHover: '#2f4a3d',
    bands: [
      { fill: '#2f5d47', ink: '#ffffff' },
      { fill: '#d9c49a', ink: '#1d2a24' },
      { fill: '#a3304e', ink: '#ffffff' },
    ],
    highlight: { fill: '#d9c49a', ink: '#1d2a24' },
    link: '#2f5d47',
    linkHover: '#234836',
    linkTint: '#e1ece5',
    onLink: '#ffffff',
  },
  {
    id: 'plum',
    label: 'Plum',
    mood: 'Plum, ochre and rose on warm paper',
    paper: '#f3ece9',
    card: '#fffbf9',
    well: '#f8f2ef',
    line: '#eadfda',
    ink: '#2e1a2b',
    muted: '#5c4558',
    ghost: '#86707f',
    side: '#2e1a2b',
    sideText: '#f3ece9',
    sideMuted: '#c9b3c2',
    sideHover: '#3e2639',
    bands: [
      { fill: '#6b3d78', ink: '#ffffff' },
      { fill: '#d9a441', ink: '#2e1a2b' },
      { fill: '#b5486a', ink: '#ffffff' },
    ],
    highlight: { fill: '#d9a441', ink: '#2e1a2b' },
    link: '#6b3d78',
    linkHover: '#552f60',
    linkTint: '#efe4f2',
    onLink: '#ffffff',
  },
];

export function isPaletteId(value: string | null | undefined): value is PaletteId {
  return PALETTE_IDS.some((id) => id === value);
}

export function paletteById(id: string | null | undefined): Palette | undefined {
  return PALETTES.find((palette) => palette.id === id);
}

/**
 * Every token a palette sets, as the theme block names them.
 *
 * Both scopes, page and sheet, because the poster has one polarity and the two
 * have to agree. The band tokens are not in the shared `--c-*` set the
 * generator clears, so `POSTER_TOKENS` below lists them for applyTheme.
 */
export function paletteTokens(palette: Palette): Record<string, string> {
  const [b1, b2, b3] = palette.bands;
  return {
    '--c-page-ground': palette.paper,
    '--c-page': palette.paper,
    '--c-surface': palette.card,
    '--c-raised': palette.card,
    '--c-canvas': palette.well,
    '--c-sunken': palette.well,
    '--c-border': palette.line,
    '--c-page-border': palette.line,
    '--c-border-strong': palette.ink,
    '--c-page-border-strong': palette.ink,
    '--c-border-control': palette.ink,
    '--c-page-border-control': palette.ink,
    '--c-sheet-outline': palette.ink,
    '--c-ink': palette.ink,
    '--c-page-ink': palette.ink,
    '--c-ink-muted': palette.muted,
    '--c-page-ink-muted': palette.muted,
    '--c-ink-ghost': palette.ghost,
    '--c-page-ink-ghost': palette.ghost,
    '--c-accent-base': palette.link,
    '--c-accent-hover': palette.linkHover,
    '--c-accent-tint-base': palette.linkTint,
    '--c-accent-base-lit': palette.link,
    '--c-accent-hover-lit': palette.linkHover,
    '--c-fill-ink': palette.onLink,
    '--c-shell': palette.side,
    '--c-shell-ink': palette.sideText,
    '--c-shell-muted': palette.sideMuted,
    '--c-shell-border': palette.sideHover,
    '--c-shell-hover': palette.sideHover,
    '--c-poster-band-1': b1.fill,
    '--c-poster-band-1-ink': b1.ink,
    '--c-poster-band-2': b2.fill,
    '--c-poster-band-2-ink': b2.ink,
    '--c-poster-band-3': b3.fill,
    '--c-poster-band-3-ink': b3.ink,
    '--c-poster-hi': palette.highlight.fill,
    '--c-poster-hi-ink': palette.highlight.ink,
  };
}

/** The poster's own tokens, which no other theme writes, so applyTheme can clear them. */
export const POSTER_TOKENS: readonly string[] = Object.keys(
  paletteTokens(PALETTES[0]!),
).filter((token) => token.startsWith('--c-poster-'));

/** What a palette writes over the block. Empty for the default, which the block already is. */
export function posterTokens(id: PaletteId): Record<string, string> {
  if (id === DEFAULT_PALETTE) return {};
  const palette = paletteById(id);
  return palette ? paletteTokens(palette) : {};
}
