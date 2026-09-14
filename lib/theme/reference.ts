/**
 * The three palettes every generated theme is built from.
 *
 * Paper, Ink and Dusk are written by hand in app/globals.css and have been
 * contrast-checked as they stand. Rather than invent colours, the generator
 * borrows theirs: it keeps each token's lightness and chroma and moves only
 * the hue. So Paper is what light is, Ink is what dark with no colour is, and
 * Dusk -- a dark already cast towards plum -- is the shape a dark theme takes
 * once a colour is chosen.
 *
 * Light with a colour rotates around LIGHT_CAST rather than around Paper
 * itself. Dusk rotates as one thing because every colour in it sits within
 * five degrees of its ground; Paper's page and Paper's accent are a hundred
 * and eighty apart, because the two were chosen independently, so rotating
 * Paper as one thing would send the accent the wrong way -- ask for green and
 * get a faintly green page with magenta links. #454 settled it: put Paper's
 * accent on Paper's own page hue, and rotate from there.
 *
 * These tables are a copy of what globals.css says, flattened -- `--c-page:
 * var(--c-canvas)` is resolved to the hex it lands on -- because the browser
 * cannot read a stylesheet before it has parsed one, and the whole point is to
 * write the palette into the page's first byte. lib/theme/palette.test.ts
 * re-reads globals.css and fails if the two have drifted, which is the only
 * thing keeping this file honest.
 */
import { hexToOklch, relativeLuminance, withLuminance } from './oklch';

/** Which of the two written polarities a generated theme is a version of. */
export type ThemeMode = 'light' | 'dark';

/** Every `--c-*` colour token, by name, as `#rrggbb`. */
export type Palette = Record<string, string>;

export const REFERENCE_PALETTES: Record<'paper' | 'ink' | 'dusk', Palette> = {
  paper: {
    '--c-canvas': '#faf9f6',
    '--c-surface': '#ffffff',
    '--c-raised': '#ffffff',
    '--c-sunken': '#f2f0ea',
    '--c-border': '#e8e5df',
    '--c-border-strong': '#d5d1c8',
    '--c-shell': '#f4f2ec',
    '--c-shell-ink': '#1a1a18',
    '--c-shell-muted': '#63635e',
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
    '--c-page': '#faf9f6',
    '--c-page-ink': '#1a1a18',
    '--c-page-ink-muted': '#6b6b66',
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
export const REFERENCE_HUE: Record<'paper' | 'dusk', number> = {
  paper: hexToOklch(REFERENCE_PALETTES.paper['--c-canvas']).h,
  dusk: hexToOklch(REFERENCE_PALETTES.dusk['--c-canvas']).h,
};

/**
 * Paper with its accent moved onto Paper's own page hue.
 *
 * What light with a colour rotates, and the answer #454 gave. Every token
 * keeps the chroma Paper wrote for it and reflects as much light as Paper's
 * did, so every contrast ratio in a light theme is the ratio Paper measured.
 * Only the accent family turns, and it turns as a family, so the tint stays
 * the four degrees off the base that Paper put it.
 *
 * The result is not a theme anybody sees on its own -- light with no colour is
 * Paper, untouched. It is the shape a light theme takes once the page and the
 * accent have to agree about which colour was asked for.
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
