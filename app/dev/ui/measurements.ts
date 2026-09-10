/**
 * The numbers.
 *
 * A guideline written in prose is obeyed by whoever already agrees with it; a
 * guideline with a number in it can be measured. These are the measurements
 * the interface is built from, written down once so an argument about a row
 * height is settled by reading rather than by screenshot.
 *
 * Every value here is copied from app/globals.css, and tests/dev-ui-
 * measurements.test.ts reads that file and fails if the two disagree. That is
 * the deal that lets a page of typed numbers call itself a mirror: the copy
 * cannot drift, because the drift is a red build.
 */

export type DensityId = 'comfortable' | 'snug' | 'dense';

/** One dial variable across the three densities, in px. */
export type DialRow = {
  variable: string;
  what: string;
  /** comfortable, snug, dense */
  px: readonly [number, number, number];
};

/**
 * The dial, below the sm breakpoint (40rem). Touch sizes are the floor.
 */
export const DIAL: readonly DialRow[] = [
  { variable: '--control-h', what: 'Control height on a phone', px: [36, 34, 32] },
  { variable: '--control-px', what: 'Control inset', px: [10, 8, 8] },
  { variable: '--row-y', what: 'Row padding, top and bottom', px: [8, 6, 4] },
  { variable: '--card-p', what: 'Card padding, standard', px: [16, 14, 10] },
  { variable: '--card-p-dense', what: 'Card padding, dense', px: [12, 10, 8] },
  { variable: '--field-gap', what: 'Between fields in a form', px: [12, 10, 8] },
];

/** Control height once there is a pointer: from 40rem up. */
export const CONTROL_H_POINTER: readonly [number, number, number] = [32, 30, 28];

/**
 * What a list row costs: one line of 13px chrome at 1.5 leading, plus the row
 * padding above and below. Rounded to the pixel, and the same as the pointer
 * control height at every density, which is not a coincidence -- a row and a
 * control on the same surface should agree.
 */
export const ROW_HEIGHT: readonly [number, number, number] = [36, 32, 28];

export const RADII: readonly { name: string; px: number; where: string }[] = [
  { name: 'rounded-card', px: 8, where: 'Cards, panels, banners, popovers, the empty state.' },
  {
    name: 'rounded-control',
    px: 6,
    where: 'Buttons, inputs, chips, menu rows, the hover ground on a list row.',
  },
  { name: 'rounded', px: 4, where: 'A keycap, and the focus outline.' },
  { name: 'rounded-full', px: 0, where: 'Badges, counts, avatars, the sigil.' },
];

/** The steps of the 4px grid that are in use, and what each one is for. */
export const SPACING: readonly { step: string; px: number; where: string }[] = [
  { step: '0.5', px: 2, where: 'Between a value and its unit; a chip’s vertical inset.' },
  { step: '1', px: 4, where: 'Between chips in a row; between rows in a nav column.' },
  { step: '1.5', px: 6, where: 'Between an icon and its label; a chip’s horizontal inset.' },
  { step: '2', px: 8, where: 'Between the parts of a row; between related lines.' },
  { step: '3', px: 12, where: 'Between a mark and a title; between related notes.' },
  { step: '4', px: 16, where: 'Between related cards; the page gutter on a phone.' },
  { step: '5', px: 20, where: 'Under the page header, owned by PageHeader.' },
  {
    step: '6',
    px: 24,
    where: 'Between unrelated sections; the page gutter from sm; page top and bottom.',
  },
  { step: '8', px: 32, where: 'Between the sections of a long page, and this one.' },
];

export const ICONS: readonly { px: number; where: string }[] = [
  { px: 14, where: 'Inside a chip, a badge, a keycap row, a disclosure’s chevron.' },
  { px: 16, where: 'Rows, nav, buttons, the palette. The default.' },
  { px: 20, where: 'The phone dock, and the icon in an empty state.' },
];

export const ICON_STROKE = 1.75;

/**
 * The layers, from the page up. Depth in three themes is a hairline; a shadow
 * at rest belongs only to the two layers that float, and there are exactly
 * two drops in the app -- shadow-lg for a thing hung off a trigger,
 * shadow-2xl for a modal centred over the scrim.
 */
export const ELEVATION: readonly Row4[] = [
  ['Page', 'bg-page', 'The wash and the grain, fixed to the viewport.', 'No edge.'],
  [
    'Sheet',
    'bg-surface',
    'A card, a table, a banner, the empty state.',
    'Hairline, no shadow. Lightbox: the lit edge.',
  ],
  [
    'Well',
    'bg-sunken · bg-canvas',
    'A recessed area inside a sheet; the hover ground of a row.',
    'No edge of its own.',
  ],
  [
    'Raised',
    'bg-raised',
    'A popover, a menu, a toast.',
    'Hairline and shadow-lg: the resting shadow.',
  ],
  ['Scrim', 'bg-black/40', 'Under the drawer and the palette.', 'Blurs the page by a pixel.'],
  [
    'Modal',
    'bg-raised over the scrim',
    'The command palette, the capture panel, the lightbox editor.',
    'Hairline and shadow-2xl: shallower and it reads as a card that has come loose.',
  ],
  [
    'Lift',
    'lift',
    'An interactive card under the cursor, for 150ms.',
    'translateY(-2px) and the lift shadow, transient.',
  ],
];

export type Row4 = readonly [string, string, string, string];

/**
 * Who paints over whom. Each rung is a named utility in app/globals.css, so a
 * call site writes the name and never the number.
 */
export const Z_LADDER: readonly { z: string; utility: string; what: string }[] = [
  {
    z: '10',
    utility: 'z-over-link',
    what: 'A control that must stay clickable above a row’s stretched link.',
  },
  { z: '20', utility: 'z-menu', what: 'A menu or listbox opened inside the page.' },
  { z: '30', utility: 'z-status', what: 'The status line.' },
  {
    z: '40',
    utility: 'z-chrome',
    what: 'The sidebar, the top bar, the phone dock, the capture button.',
  },
  { z: '50', utility: 'z-overlay', what: 'The drawer, popovers, action menus.' },
  {
    z: '60',
    utility: 'z-modal',
    what: 'A modal over a scrim: the palette, the capture panel, the lightbox editor.',
  },
  { z: '70', utility: 'z-toast', what: 'Toasts.' },
  { z: '9999', utility: 'z-grain', what: 'The grain, which no pointer can touch.' },
];

export const MOTION: readonly Row4[] = [
  ['Duration', '150ms', 'Everything. A second duration needs a written reason.', '--ease-out-soft'],
  ['press', 'scale(0.98)', 'Every button, chip and summary, while held.', '150ms'],
  ['lift', 'translateY(-2px) + shadow', 'An interactive card under the cursor.', '150ms'],
  ['dragging', 'scale(0.98) rotate(-0.5°), 55% opacity', 'The pipeline card mid-drag.', '—'],
  ['toast-in', '6px rise, fade in', 'A toast arriving. Nothing on the way out.', '180ms'],
  ['keyhint', 'fade', 'Shortcut hints while a modifier is held.', '120ms'],
  ['status line', 'fade back', 'The line settling after it has been read.', '1000ms'],
  ['shimmer', 'a highlight crossing', 'A skeleton, and nothing else.', '1.6s loop'],
];

export const MOTION_RULES: readonly string[] = [
  'One duration, one easing. Motion confirms that something happened; it never announces that something is about to.',
  'Things arrive; they do not leave. A toast animates in and is simply gone.',
  'A skeleton shimmers; a spinner does not exist.',
  'prefers-reduced-motion removes all of it, no exceptions, including the count-up on the dashboard. Any new animation is added to that block in the same commit.',
  'Never delay the user to be charming. A flourish is under a second, is chrome, and can be switched off.',
];
