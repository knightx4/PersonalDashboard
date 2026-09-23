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

/**
 * The two widths the page anatomies are drawn at, and how far each is scaled
 * down to fit the column they are shown in.
 *
 * 390 is a phone held in one hand and is below every breakpoint the app
 * writes, so the drawing gets the touch end of the density dial and whatever a
 * component does when it has no room. 1280 is the widest breakpoint the layout
 * waits for -- the filter rail becomes a column there -- so above it nothing
 * further changes and a wider frame would only be more empty page.
 *
 * The heights are the viewports those two widths come with -- an iPhone and a
 * laptop window -- so a drawing shows what is above the fold as well as where
 * things sit.
 *
 * Scaled rather than resized. `transform: scale` keeps the layout at its real
 * width and draws it smaller, so what is on the page is genuinely the 390px
 * arrangement; a 195px-wide iframe would just be a narrower phone, which is
 * the mistake the frame exists to avoid. tests/dev-ui-measurements.test.ts
 * holds both widths against the breakpoints they claim to sit either side of.
 */
export const ANATOMY_FRAMES: readonly {
  id: string;
  label: string;
  width: number;
  height: number;
  scale: number;
}[] = [
  { id: 'phone', label: 'Phone · 390', width: 390, height: 844, scale: 0.5 },
  { id: 'laptop', label: 'Laptop · 1280', width: 1280, height: 900, scale: 0.4 },
];

export const RADII: readonly { name: string; px: number; where: string }[] = [
  { name: 'rounded-pane', px: 16, where: 'The page pane, which is the only thing that floats the shell.' },
  { name: 'rounded-card', px: 12, where: 'Cards, panels, banners, popovers, the empty state.' },
  {
    name: 'rounded-control',
    px: 8,
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
  ['swipe', 'follows the finger, springs back', 'A Quick read card dragged left. Still under reduced motion.', '150ms'],
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

/**
 * The stacking contexts the shell makes, and which rungs each one boxes.
 *
 * A z-index only ranks an element against the others in its own stacking
 * context, so two rungs in different contexts do not compare at all. The shell
 * makes several: the sidebar and the top bar are sticky with a rung on them,
 * the top bar, the dock and the status line carry backdrop-blur, a table that
 * scrolls sideways carries a mask, and a card under the cursor is transformed
 * for as long as the pointer is on it.
 *
 * This table is the result of walking every call site of a rung utility in
 * app/ and components/ up its ancestors, looking for transform, filter,
 * backdrop-filter, mask, contain and an opacity below 1. It is beside the
 * ladder because the ladder on its own implies eight rungs that can all be
 * compared, and they cannot.
 */
export const STACKING_CONTEXTS: readonly Row4[] = [
  [
    'The sidebar column',
    'sticky top-0 with z-chrome on it.',
    'Rung 40 against the page.',
    'The workspace switcher’s popover is z-overlay inside it. That 50 counts only inside the column; against the page the whole column is 40.',
  ],
  [
    'The top bar',
    'sticky top-0 with z-chrome, plus backdrop-blur.',
    'Rung 40 against the page.',
    'The theme, notification and feedback popovers and the phone workspace switcher are z-overlay inside it, so against the page they are 40 too. backdrop-blur also makes the bar the containing block for their fixed positioning, so their offsets are measured from the bar rather than from the window.',
  ],
  [
    'The phone dock',
    'fixed bottom-0 with z-chrome, plus backdrop-blur.',
    'Rung 40, and after the top bar in the document.',
    'Nothing carrying a rung. Equal rungs are ordered by document position, so the dock paints over the top bar and over everything boxed inside it.',
  ],
  [
    'The status line',
    'sticky bottom-0 with z-status, plus backdrop-blur.',
    'Rung 30.',
    'Nothing carrying a rung.',
  ],
  [
    'A drawer, sheet, palette or capture panel',
    'fixed inset-0 with its own rung.',
    'Rung 50 or 60, in the page’s outermost context.',
    'Its own scrim and panel. Each is mounted at the top of the shell rather than inside a page, which is what keeps it comparable with the rest of the ladder.',
  ],
  [
    'A table that scrolls sideways',
    'scroll-fade-x, which is a mask.',
    'No rung of its own.',
    'z-over-link on a cell of the roles table, below lg. The stretched link it has to stay above is in the same box, so that pair still compares.',
  ],
  [
    'An interactive card under the cursor',
    'lift, which is a transform while hovered.',
    'No rung of its own.',
    'Nothing today. A panel inside one would be boxed for as long as the pointer is on the card, and a fixed child would measure from the card; ActionMenu avoids both by rendering into the body.',
  ],
  [
    'A pipeline card being dragged',
    'dragging: a transform and opacity 0.55.',
    'No rung of its own.',
    'Nothing carrying a rung.',
  ],
];

/** What the trace above means for reading the ladder. */
export const STACKING_RULES: readonly string[] = [
  'A rung compares only with the rungs in the same stacking context. Against anything outside it, the number that counts is the one on the outermost box.',
  'A popover opened from the top bar ranks 40 against the page rather than 50. The phone dock is 40 as well and comes later in the document, so a top-bar panel long enough to reach the foot of a phone is painted over by the dock.',
  'The workspace switcher’s popover stands in the same relation to the top bar and misses it on geometry alone: the popover opens 62px down the column and the bar ends at 57px.',
  'The palette, the capture panel and the toasts cover the drawer because all four are mounted at the top of the shell. Open one of them from inside a page and its rung stops meaning what the ladder says.',
  'backdrop-blur, a transform, a mask and an opacity below 1 each make a stacking context, and the first two also make the element the containing block for a fixed child. Putting one of them above a rung changes what that rung means.',
];
