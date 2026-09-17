/**
 * The palettes every generated theme is built from.
 *
 * Paper, Ink, Dusk and Lightbox are written by hand in app/globals.css and
 * have been contrast-checked as they stand. Rather than invent colours, the
 * generator borrows theirs: it keeps each token's lightness and chroma and
 * moves only the hue. So Paper is what light is, Ink is what dark with no
 * colour is, Dusk -- a dark already cast towards plum -- is the shape a dark
 * theme takes once a colour is chosen, and Lightbox is its own shape again.
 *
 * Light with a colour rotates around LIGHT_CAST rather than around Paper
 * itself. Dusk rotates as one thing because every colour in it sits within
 * five degrees of its ground; Paper's page and Paper's accent are a hundred
 * and eighty apart, because the two were chosen independently, so rotating
 * Paper as one thing would send the accent the wrong way -- ask for green and
 * get a faintly green page with magenta links. #454 settled it: put Paper's
 * accent on Paper's own page hue, and rotate from there. LIGHT_CAST also
 * carries more chroma in its neutrals than Paper does, because Paper's are
 * near-greys and a near-grey in another hue is still a near-grey; that is
 * #456.
 *
 * These tables are a copy of what globals.css says, flattened -- `--c-page:
 * var(--c-page-ground)` is resolved to the hex it lands on -- because the browser
 * cannot read a stylesheet before it has parsed one, and the whole point is to
 * write the palette into the page's first byte. lib/theme/palette.test.ts
 * re-reads globals.css and fails if the two have drifted, which is the only
 * thing keeping this file honest.
 */
import { hexToOklch, relativeLuminance, withLuminance } from './oklch';

/**
 * Which written palette a generated theme is a version of.
 *
 * Light and dark are the switch. Lightbox is the third, and it is a mode
 * rather than a fourth preset because its page and its cards are opposite
 * polarities: lit sheets on a dark bench cannot be said as light or as dark,
 * but it rotates around a hue the same way the other two do.
 */
export type ThemeMode = 'light' | 'dark' | 'lightbox';

/** Every `--c-*` colour token, by name, as `#rrggbb`. */
export type Palette = Record<string, string>;

export const REFERENCE_PALETTES: Record<'paper' | 'ink' | 'dusk' | 'lightbox', Palette> = {
  paper: {
    '--c-canvas': '#faf9f6',
    '--c-surface': '#ffffff',
    '--c-raised': '#ffffff',
    '--c-sunken': '#f2f0ea',
    '--c-border': '#e8e5df',
    '--c-border-strong': '#d5d1c8',
    '--c-shell': '#e4dfd2',
    '--c-shell-ink': '#1a1a18',
    '--c-shell-muted': '#5d5d58',
    '--c-shell-border': '#e2dfd7',
    '--c-shell-hover': '#eae7df',
    '--c-ink': '#1a1a18',
    '--c-ink-muted': '#6b6b66',
    '--c-ink-ghost': '#85857e',
    '--c-border-control': '#85857e',
    '--c-accent-base': '#4a5fd0',
    '--c-accent-hover': '#3f52bd',
    '--c-accent-tint-base': '#eef1fe',
    '--c-w-shopping': '#be1250',
    '--c-w-shopping-tint': '#fdecf2',
    '--c-w-jobs': '#7c3aed',
    '--c-w-jobs-tint': '#f4f0fe',
    '--c-w-todo': '#036695',
    '--c-w-todo-tint': '#e6f4fb',
    '--c-w-vault': '#a21caf',
    '--c-w-vault-tint': '#fcecfd',
    '--c-w-learn': '#0f6b62',
    '--c-w-learn-tint': '#e4f4f1',
    '--c-w-news': '#806500',
    '--c-w-news-tint': '#f6f1e2',
    '--c-w-dev': '#4b5768',
    '--c-w-dev-tint': '#eef1f5',
    '--c-positive': '#286f50',
    '--c-positive-tint': '#ecf7f1',
    '--c-caution': '#a34a07',
    '--c-caution-fill': '#f0a63f',
    '--c-caution-tint': '#fdf3e3',
    '--c-danger': '#b91c1c',
    '--c-danger-tint': '#fef2f2',
    '--c-status-lead': '#6f6864',
    '--c-status-lead-tint': '#f5f5f4',
    '--c-status-submitted': '#2563eb',
    '--c-status-submitted-tint': '#eff6ff',
    '--c-status-process': '#b45309',
    '--c-status-process-tint': '#fffbeb',
    '--c-status-final': '#7c3aed',
    '--c-status-final-tint': '#f5f3ff',
    '--c-status-offer': '#047857',
    '--c-status-offer-tint': '#ecfdf5',
    '--c-status-rejected': '#b91c1c',
    '--c-status-rejected-tint': '#fef2f2',
    '--c-status-ghosted': '#78716c',
    '--c-status-ghosted-tint': '#fafaf9',
    '--c-sheet-outline': '#e8e5df',
    '--c-caution-fill-ink': '#14100a',
    '--c-fill-ink': '#ffffff',
    '--c-page-ground': '#f0ece2',
    '--c-page': '#f0ece2',
    '--c-page-ink': '#1a1a18',
    '--c-page-ink-muted': '#65655f',
    '--c-page-ink-ghost': '#85857e',
    '--c-page-border': '#e8e5df',
    '--c-page-border-strong': '#d5d1c8',
    '--c-page-border-control': '#85857e',
    '--c-page-positive': '#286f50',
    '--c-page-caution': '#a34a07',
    '--c-page-danger': '#b91c1c',
    '--c-accent-base-lit': '#4a5fd0',
    '--c-accent-hover-lit': '#3f52bd',
    '--c-w-shopping-lit': '#be1250',
    '--c-w-jobs-lit': '#7c3aed',
    '--c-w-todo-lit': '#036695',
    '--c-w-vault-lit': '#a21caf',
    '--c-w-learn-lit': '#0f6b62',
    '--c-w-news-lit': '#806500',
    '--c-w-dev-lit': '#4b5768',
    '--c-sheet-ink': '#1a1a18',
    '--c-sheet-ink-muted': '#6b6b66',
    '--c-sheet-ink-ghost': '#85857e',
    '--c-sheet-border': '#e8e5df',
    '--c-sheet-border-strong': '#d5d1c8',
    '--c-sheet-border-control': '#85857e',
    '--c-sheet-positive': '#286f50',
    '--c-sheet-caution': '#a34a07',
    '--c-sheet-danger': '#b91c1c',
  },
  ink: {
    '--c-canvas': '#08090a',
    '--c-surface': '#0f1011',
    '--c-raised': '#191a1c',
    '--c-sunken': '#050506',
    '--c-border': '#212225',
    '--c-border-strong': '#2e3033',
    '--c-shell': '#0b0c0d',
    '--c-shell-ink': '#f7f8f8',
    '--c-shell-muted': '#9096a0',
    '--c-shell-border': '#1c1d20',
    '--c-shell-hover': '#17181a',
    '--c-ink': '#f7f8f8',
    '--c-ink-muted': '#9096a0',
    '--c-ink-ghost': '#6a707a',
    '--c-border-control': '#6a707a',
    '--c-accent-base': '#8b9dff',
    '--c-accent-hover': '#a3b2ff',
    '--c-accent-tint-base': '#161a33',
    '--c-w-shopping': '#ff8fa8',
    '--c-w-shopping-tint': '#301620',
    '--c-w-jobs': '#b39bff',
    '--c-w-jobs-tint': '#1e1733',
    '--c-w-todo': '#4cc2f1',
    '--c-w-todo-tint': '#0b2130',
    '--c-w-vault': '#e690f2',
    '--c-w-vault-tint': '#2a1430',
    '--c-w-learn': '#4fd1c5',
    '--c-w-learn-tint': '#0a2420',
    '--c-w-news': '#d8b23d',
    '--c-w-news-tint': '#281e03',
    '--c-w-dev': '#a9b6c8',
    '--c-w-dev-tint': '#1a1f27',
    '--c-positive': '#54d6a0',
    '--c-positive-tint': '#0c2119',
    '--c-caution': '#f0a63f',
    '--c-caution-fill': '#f0a63f',
    '--c-caution-tint': '#2a1c09',
    '--c-danger': '#ff8b8b',
    '--c-danger-tint': '#2b1315',
    '--c-status-lead': '#a8a49b',
    '--c-status-lead-tint': '#1c1c1e',
    '--c-status-submitted': '#7ea9ff',
    '--c-status-submitted-tint': '#111a2e',
    '--c-status-process': '#e8a84e',
    '--c-status-process-tint': '#2a1c09',
    '--c-status-final': '#c0a5ff',
    '--c-status-final-tint': '#1d1730',
    '--c-status-offer': '#54d6a0',
    '--c-status-offer-tint': '#0c2119',
    '--c-status-rejected': '#ff8b8b',
    '--c-status-rejected-tint': '#2b1315',
    '--c-status-ghosted': '#8b9099',
    '--c-status-ghosted-tint': '#141516',
    '--c-sheet-outline': '#212225',
    '--c-caution-fill-ink': '#14100a',
    '--c-fill-ink': '#0f1011',
    '--c-page-ground': '#08090a',
    '--c-page': '#08090a',
    '--c-page-ink': '#f7f8f8',
    '--c-page-ink-muted': '#9096a0',
    '--c-page-ink-ghost': '#6a707a',
    '--c-page-border': '#212225',
    '--c-page-border-strong': '#2e3033',
    '--c-page-border-control': '#6a707a',
    '--c-page-positive': '#54d6a0',
    '--c-page-caution': '#f0a63f',
    '--c-page-danger': '#ff8b8b',
    '--c-accent-base-lit': '#8b9dff',
    '--c-accent-hover-lit': '#a3b2ff',
    '--c-w-shopping-lit': '#ff8fa8',
    '--c-w-jobs-lit': '#b39bff',
    '--c-w-todo-lit': '#4cc2f1',
    '--c-w-vault-lit': '#e690f2',
    '--c-w-learn-lit': '#4fd1c5',
    '--c-w-news-lit': '#d8b23d',
    '--c-w-dev-lit': '#a9b6c8',
    '--c-sheet-ink': '#f7f8f8',
    '--c-sheet-ink-muted': '#9096a0',
    '--c-sheet-ink-ghost': '#6a707a',
    '--c-sheet-border': '#212225',
    '--c-sheet-border-strong': '#2e3033',
    '--c-sheet-border-control': '#6a707a',
    '--c-sheet-positive': '#54d6a0',
    '--c-sheet-caution': '#f0a63f',
    '--c-sheet-danger': '#ff8b8b',
  },
  dusk: {
    '--c-canvas': '#110d1a',
    '--c-surface': '#191426',
    '--c-raised': '#241d35',
    '--c-sunken': '#0b0812',
    '--c-border': '#2c2440',
    '--c-border-strong': '#3b3153',
    '--c-shell': '#0f0c17',
    '--c-shell-ink': '#f2eefa',
    '--c-shell-muted': '#a79fc0',
    '--c-shell-border': '#241d35',
    '--c-shell-hover': '#1c1729',
    '--c-ink': '#f2eefa',
    '--c-ink-muted': '#a79fc0',
    '--c-ink-ghost': '#7a7394',
    '--c-border-control': '#7a7394',
    '--c-accent-base': '#b9a5ff',
    '--c-accent-hover': '#cbbcff',
    '--c-accent-tint-base': '#241c3d',
    '--c-w-shopping': '#ff9ab5',
    '--c-w-shopping-tint': '#331a29',
    '--c-w-jobs': '#c0a5ff',
    '--c-w-jobs-tint': '#271e42',
    '--c-w-todo': '#6fcdf0',
    '--c-w-todo-tint': '#132833',
    '--c-w-vault': '#ec9df3',
    '--c-w-vault-tint': '#301a3a',
    '--c-w-learn': '#74dccf',
    '--c-w-learn-tint': '#102c29',
    '--c-w-news': '#dcb956',
    '--c-w-news-tint': '#2c2205',
    '--c-w-dev': '#b3bfcf',
    '--c-w-dev-tint': '#212832',
    '--c-positive': '#68d9aa',
    '--c-positive-tint': '#13291f',
    '--c-caution': '#f2b25a',
    '--c-caution-fill': '#f2b25a',
    '--c-caution-tint': '#2e2210',
    '--c-danger': '#ff96a4',
    '--c-danger-tint': '#331a22',
    '--c-status-lead': '#a89fb8',
    '--c-status-lead-tint': '#211b2e',
    '--c-status-submitted': '#8fb4ff',
    '--c-status-submitted-tint': '#1a2038',
    '--c-status-process': '#f2b25a',
    '--c-status-process-tint': '#2e2210',
    '--c-status-final': '#c0a5ff',
    '--c-status-final-tint': '#271e42',
    '--c-status-offer': '#68d9aa',
    '--c-status-offer-tint': '#13291f',
    '--c-status-rejected': '#ff96a4',
    '--c-status-rejected-tint': '#331a22',
    '--c-status-ghosted': '#9a91af',
    '--c-status-ghosted-tint': '#1c1728',
    '--c-sheet-outline': '#2c2440',
    '--c-caution-fill-ink': '#14100a',
    '--c-fill-ink': '#191426',
    '--c-page-ground': '#110d1a',
    '--c-page': '#110d1a',
    '--c-page-ink': '#f2eefa',
    '--c-page-ink-muted': '#a79fc0',
    '--c-page-ink-ghost': '#7a7394',
    '--c-page-border': '#2c2440',
    '--c-page-border-strong': '#3b3153',
    '--c-page-border-control': '#7a7394',
    '--c-page-positive': '#68d9aa',
    '--c-page-caution': '#f2b25a',
    '--c-page-danger': '#ff96a4',
    '--c-accent-base-lit': '#b9a5ff',
    '--c-accent-hover-lit': '#cbbcff',
    '--c-w-shopping-lit': '#ff9ab5',
    '--c-w-jobs-lit': '#c0a5ff',
    '--c-w-todo-lit': '#6fcdf0',
    '--c-w-vault-lit': '#ec9df3',
    '--c-w-learn-lit': '#74dccf',
    '--c-w-news-lit': '#dcb956',
    '--c-w-dev-lit': '#b3bfcf',
    '--c-sheet-ink': '#f2eefa',
    '--c-sheet-ink-muted': '#a79fc0',
    '--c-sheet-ink-ghost': '#7a7394',
    '--c-sheet-border': '#2c2440',
    '--c-sheet-border-strong': '#3b3153',
    '--c-sheet-border-control': '#7a7394',
    '--c-sheet-positive': '#68d9aa',
    '--c-sheet-caution': '#f2b25a',
    '--c-sheet-danger': '#ff96a4',
  },
  /**
   * Lightbox, and the reason it is a mode of its own.
   *
   * Two polarities on screen at once: a mid-dark bench, and lit sheets laid on
   * it. The four sheet grounds are written with alpha so a card picks up the
   * bench beneath it, which is why four values here are `rgb(... / a)` rather
   * than hex -- they are composited before anything is measured against them,
   * and the generator leaves them alone.
   */
  lightbox: {
    '--c-canvas': 'rgb(231 236 242 / 0.88)',
    '--c-surface': 'rgb(253 252 249 / 0.80)',
    '--c-raised': 'rgb(255 254 250 / 0.86)',
    '--c-sunken': 'rgb(228 234 241 / 0.86)',
    '--c-border': '#d0d9e3',
    '--c-border-strong': '#a6b1bf',
    '--c-shell': '#25374f',
    '--c-shell-ink': '#eef2f7',
    '--c-shell-muted': '#b6c1ce',
    '--c-shell-border': '#3d4b5c',
    '--c-shell-hover': '#364354',
    '--c-ink': '#10141a',
    '--c-ink-muted': '#464f59',
    '--c-ink-ghost': '#626c78',
    '--c-border-control': '#626c78',
    '--c-accent-base': '#32459f',
    '--c-accent-hover': '#28377f',
    '--c-accent-tint-base': '#e0e5f6',
    '--c-w-shopping': '#a30f46',
    '--c-w-shopping-tint': '#f6dde6',
    '--c-w-jobs': '#6420cf',
    '--c-w-jobs-tint': '#e8dffa',
    '--c-w-todo': '#035b79',
    '--c-w-todo-tint': '#d9e9f1',
    '--c-w-vault': '#891489',
    '--c-w-vault-tint': '#f2def2',
    '--c-w-learn': '#0a5d54',
    '--c-w-learn-tint': '#d8ebe7',
    '--c-w-news': '#6e5600',
    '--c-w-news-tint': '#ece4cf',
    '--c-w-dev': '#434e5f',
    '--c-w-dev-tint': '#e6eaf0',
    '--c-positive': '#17624a',
    '--c-positive-tint': '#d8ece4',
    '--c-caution': '#8a480a',
    '--c-caution-fill': '#e8992f',
    '--c-caution-tint': '#f2e6d6',
    '--c-danger': '#9e1a1a',
    '--c-danger-tint': '#f5dcdc',
    '--c-status-lead': '#4f5862',
    '--c-status-lead-tint': '#e3e8ee',
    '--c-status-submitted': '#1a48cc',
    '--c-status-submitted-tint': '#dde4fa',
    '--c-status-process': '#8a480a',
    '--c-status-process-tint': '#f2e6d6',
    '--c-status-final': '#6420cf',
    '--c-status-final-tint': '#e8dffa',
    '--c-status-offer': '#17624a',
    '--c-status-offer-tint': '#d8ece4',
    '--c-status-rejected': '#9e1a1a',
    '--c-status-rejected-tint': '#f5dcdc',
    '--c-status-ghosted': '#515a64',
    '--c-status-ghosted-tint': '#dfe5eb',
    '--c-sheet-outline': 'rgb(18 24 34 / 0.42)',
    '--c-caution-fill-ink': '#14100a',
    '--c-fill-ink': '#f7f9fc',
    '--c-page-ground': '#25374f',
    '--c-page': '#25374f',
    '--c-page-ink': '#eef2f7',
    '--c-page-ink-muted': '#b6c1ce',
    '--c-page-ink-ghost': '#8a97a7',
    '--c-page-border': '#3d4b5c',
    '--c-page-border-strong': '#6d8098',
    '--c-page-border-control': '#8a97a7',
    '--c-page-positive': '#6fe0b0',
    '--c-page-caution': '#f5b459',
    '--c-page-danger': '#ff9d9d',
    '--c-accent-base-lit': '#a6b4ff',
    '--c-accent-hover-lit': '#bcc6ff',
    '--c-w-shopping-lit': '#ffa3b8',
    '--c-w-jobs-lit': '#c3b0ff',
    '--c-w-todo-lit': '#6ccdf5',
    '--c-w-vault-lit': '#eda6f6',
    '--c-w-learn-lit': '#6fdcd2',
    '--c-w-news-lit': '#debf69',
    '--c-w-dev-lit': '#bcc7d6',
    '--c-sheet-ink': '#10141a',
    '--c-sheet-ink-muted': '#464f59',
    '--c-sheet-ink-ghost': '#626c78',
    '--c-sheet-border': '#d0d9e3',
    '--c-sheet-border-strong': '#a6b1bf',
    '--c-sheet-border-control': '#626c78',
    '--c-sheet-positive': '#17624a',
    '--c-sheet-caution': '#8a480a',
    '--c-sheet-danger': '#9e1a1a',
  },
};

/**
 * The tokens a chosen colour moves: the grounds, the text, the borders and the
 * app's own accent.
 *
 * Everything left out keeps the reference's own colour, which is what #421
 * settled. Shopping stays pink and learn stays teal because a module's colour
 * is how you tell at a glance which one you are in, and green still means
 * saved and red still means delete because those two are not decoration. Dusk
 * is the proof it works: it is a heavily cast theme whose workspace hues are
 * near enough Ink's.
 */
export const HUE_TOKENS: readonly string[] = [
  // Grounds.
  '--c-canvas',
  '--c-surface',
  '--c-raised',
  '--c-sunken',
  '--c-page',
  '--c-shell',
  '--c-shell-hover',
  // Text, in all three scopes: the sheet, the page ground, and the shell.
  '--c-ink',
  '--c-ink-muted',
  '--c-ink-ghost',
  '--c-sheet-ink',
  '--c-sheet-ink-muted',
  '--c-sheet-ink-ghost',
  '--c-page-ink',
  '--c-page-ink-muted',
  '--c-page-ink-ghost',
  '--c-shell-ink',
  '--c-shell-muted',
  // Borders, including the control border that owes 3:1 on its own.
  '--c-border',
  '--c-border-strong',
  '--c-border-control',
  '--c-sheet-border',
  '--c-sheet-border-strong',
  '--c-sheet-border-control',
  '--c-sheet-outline',
  '--c-page-border',
  '--c-page-border-strong',
  '--c-page-border-control',
  '--c-shell-border',
  // The app's own accent -- links, active state, the primary button.
  '--c-accent-base',
  '--c-accent-hover',
  '--c-accent-tint-base',
  '--c-accent-base-lit',
  '--c-accent-hover-lit',
];

/**
 * The tokens a chosen colour moves on Lightbox: the bench, and everything
 * written on it.
 *
 * A shorter list than the other two modes get, and that is what #467 settled.
 * Lightbox has two polarities on screen at once, and only one of them is the
 * room: the bench, the text on it, its borders, the line where a sheet ends,
 * and the app's accent in its lit form, which is the one that lands on the
 * bench. Every one of those sits within three degrees of the bench's own hue,
 * so they rotate as one thing the way Dusk does.
 *
 * What is left out is the sheet. Its grounds stay the warm near-white they
 * are, its ink stays near-black, and its own accent stays where it was written
 * -- a sheet is paper under a lamp, and paper does not take the colour of the
 * room it is in. The glow around a sheet and the wash across the bench stay
 * too: both are written as gradients and shadow stacks rather than as flat
 * tokens, so the generator cannot read them at all.
 */
export const LIGHTBOX_HUE_TOKENS: readonly string[] = [
  // The bench, which is the page ground and the sidebar at the same value.
  '--c-page',
  '--c-shell',
  '--c-shell-hover',
  // Its text, in both scopes that land on it.
  '--c-page-ink',
  '--c-page-ink-muted',
  '--c-page-ink-ghost',
  '--c-shell-ink',
  '--c-shell-muted',
  // Its borders, and the outline that separates a sheet from it.
  '--c-page-border',
  '--c-page-border-strong',
  '--c-page-border-control',
  '--c-shell-border',
  '--c-sheet-outline',
  // The app's own accent, in the lit form that clears the bench.
  '--c-accent-base-lit',
  '--c-accent-hover-lit',
];

/** Which tokens take the colour in one mode. */
export function hueTokensFor(mode: ThemeMode): readonly string[] {
  return mode === 'lightbox' ? LIGHTBOX_HUE_TOKENS : HUE_TOKENS;
}

/**
 * The tokens carrying the app's own accent -- links, active state, the primary
 * button and its tint. A subset of HUE_TOKENS, named on its own because light
 * has to move them before it rotates anything.
 */
export const ACCENT_TOKENS: readonly string[] = [
  '--c-accent-base',
  '--c-accent-hover',
  '--c-accent-tint-base',
  '--c-accent-base-lit',
  '--c-accent-hover-lit',
];

/**
 * The hue a reference is already cast towards, read off its own page ground.
 *
 * Computed rather than written down so that generating at exactly this hue is
 * the identity: Dusk asked for its own hue comes back as Dusk, hex for hex,
 * rather than a rounding away from it.
 */
export const REFERENCE_HUE: Record<'paper' | 'dusk' | 'lightbox', number> = {
  paper: hexToOklch(REFERENCE_PALETTES.paper['--c-page']).h,
  dusk: hexToOklch(REFERENCE_PALETTES.dusk['--c-canvas']).h,
  // Lightbox's canvas is a sheet rather than the room, so its own hue is read
  // off the bench -- which is what --c-page is in a two-polarity theme.
  lightbox: hexToOklch(REFERENCE_PALETTES.lightbox['--c-page']).h,
};

/**
 * How much colour the grounds, the borders and the text of a cast light theme
 * carry.
 *
 * Paper writes its neutrals between 0.004 and 0.013 chroma, which is about
 * what Ink writes for dark with no colour -- they are near-greys, and a
 * near-grey turned to another hue is still a near-grey. Dark never had that
 * problem because it turns Dusk, a palette written with the colour already in
 * it at 0.022 to 0.060. Light turned Paper, so a chosen colour reached the
 * links and almost nothing else, which is what #456 reported.
 *
 * 0.045 is the middle of Dusk's range, so light now carries about what dark
 * carries. Near white there is less room than that -- sRGB holds little chroma
 * at 95% luminance, and less again in the warm hues -- so the page and the
 * cards take what fits and the borders, the wells, the sidebar and the text,
 * which all sit lower, take the whole amount.
 */
const CAST_CHROMA = 0.045;

/**
 * Paper with its accent moved onto Paper's own page hue, and its neutrals
 * given enough colour to see.
 *
 * What light with a colour rotates. The accent move is the answer #454 gave:
 * Paper's page and Paper's accent sit a hundred and eighty apart, so rotating
 * Paper as one thing would answer green with a green page and magenta links.
 * The chroma lift is #456 -- Paper's own neutrals are too close to grey to
 * show which colour was asked for.
 *
 * Both are done at Paper's luminance, so every contrast ratio in a light theme
 * is still the ratio Paper measured. Chroma is free that way: contrast depends
 * on how much light a colour reflects and not at all on how colourful it is,
 * and a token that cannot hold the chroma at its own luminance gives up the
 * chroma rather than the luminance. `--c-surface` is the limit of that -- pure
 * white reflects everything, so a white card stays white and the room shows in
 * its border, the page behind it and the wells inside it.
 *
 * The result is not a theme anybody sees on its own -- light with no colour is
 * Paper, untouched. It is the shape a light theme takes once a colour has been
 * chosen.
 */
export const LIGHT_CAST: Palette = (() => {
  const paper = REFERENCE_PALETTES.paper;
  const turn = REFERENCE_HUE.paper - hexToOklch(paper['--c-accent-base']!).h;

  const cast: Palette = { ...paper };
  for (const token of ACCENT_TOKENS) {
    const value = paper[token]!;
    const colour = hexToOklch(value);
    // Luminance rather than lightness, the same as every other turn the
    // generator makes: a hundred and eighty degrees is the largest move in the
    // whole scheme, and it is the one where holding the wrong quantity shows.
    cast[token] = withLuminance({ ...colour, h: colour.h + turn }, relativeLuminance(value));
  }

  // The accent already carries 0.107, well past the lift, and it is the one
  // token nobody said was faded.
  for (const token of HUE_TOKENS) {
    if (ACCENT_TOKENS.includes(token)) continue;
    const value = paper[token]!;
    const colour = hexToOklch(value);
    if (colour.c >= CAST_CHROMA) continue;
    cast[token] = withLuminance({ ...colour, c: CAST_CHROMA }, relativeLuminance(value));
  }
  return cast;
})();

/**
 * Every token a palette carries, by name.
 *
 * What a caller clearing a generated theme off the document has to remove:
 * the picker writes these as inline custom properties to preview a colour,
 * and going back to a written theme means taking every one of them off again.
 */
export const TOKEN_NAMES: readonly string[] = Object.keys(REFERENCE_PALETTES.paper);
