/**
 * What the palette section of /dev/ui draws.
 *
 * A plain module rather than part of the page, so the strip can be checked
 * against the tokens a theme actually carries. The page used to list four
 * named themes; since #420 there is no list -- light or dark and any hue on
 * the circle -- so what it shows is the palette you are in, and a sweep of
 * what the others would be.
 */

/** One band of the strip: the utility that paints it, its token, its name. */
export type PaletteBand = readonly [utility: string, token: string, label: string];

/**
 * The grounds and the inks, darkest ground to lightest ink.
 *
 * Only tokens a theme declares directly. The scoped ones -- the accent, the
 * page ink -- take their value from <body>, so a band drawn with one of those
 * inside a card would show the sheet's answer and call it the theme's.
 */
export const PALETTE_STRIP: readonly PaletteBand[] = [
  ['bg-canvas', '--c-canvas', 'ground'],
  ['bg-surface', '--c-surface', 'sheet'],
  ['bg-raised', '--c-raised', 'raised'],
  ['bg-sunken', '--c-sunken', 'well'],
  ['bg-border', '--c-border', 'hairline'],
  ['bg-ink-ghost', '--c-ink-ghost', 'ghost'],
  ['bg-ink-muted', '--c-ink-muted', 'muted'],
  ['bg-ink', '--c-ink', 'ink'],
];

/** The six workspace hues and the three meanings, which no colour moves. */
export const FIXED_STRIP = [
  'bg-w-shopping',
  'bg-w-jobs',
  'bg-w-todo',
  'bg-w-vault',
  'bg-w-learn',
  'bg-w-dev',
  'bg-positive',
  'bg-caution',
  'bg-danger',
] as const;

/**
 * The hues the sweep shows, every thirty degrees.
 *
 * Twelve, which is half the resolution scripts/check-contrast.ts walks: this
 * one is for looking at, and twenty-four squares in a row is a gradient rather
 * than a set of choices.
 */
export const HUE_SWEEP: readonly number[] = Array.from({ length: 12 }, (_, step) => step * 30);
