/**
 * Themes.
 *
 * A theme is a ground, an ink, a border and a mood -- around twenty CSS
 * variables, defined in app/globals.css. That the list is short is the point:
 * a theme small enough to read in one screen is one a person could plausibly
 * write themselves, which is the only reason to have more than two.
 *
 * Named rather than numbered. A named thing is a thing you choose; a numbered
 * thing is a setting you tolerate.
 *
 * No `server-only` here: the picker is a client component and the layout is a
 * server one, and both need this list.
 */

export const THEMES = [
  {
    id: 'paper',
    label: 'Paper',
    mood: 'Warm, printed, quiet',
    scheme: 'light',
    /** For the picker's swatch, before the theme is applied. */
    swatch: '#faf9f6',
    ink: '#1a1a18',
  },
  {
    id: 'ink',
    label: 'Ink',
    mood: 'Near-black, low chroma',
    scheme: 'dark',
    swatch: '#0f1011',
    ink: '#f7f8f8',
  },
  {
    id: 'lightbox',
    label: 'Lightbox',
    mood: 'Lit sheets, blue-black bench',
    // The one theme whose page and cards disagree, which is why it is a mode
    // of its own rather than a dark. `scheme` is what the browser is told to
    // paint its own widgets in, and that is the bench.
    scheme: 'dark',
    swatch: '#0d1219',
    ink: '#e7ebf1',
  },
  {
    id: 'darkroom',
    label: 'Darkroom',
    mood: 'Smoked glass, same bench',
    // Lightbox with the lights off: one polarity rather than two, because the
    // sheets stopped being the light source.
    scheme: 'dark',
    swatch: '#25374f',
    ink: '#eaf0f8',
  },
  {
    id: 'dusk',
    label: 'Dusk',
    mood: 'Plum-cast, soft edges',
    scheme: 'dark',
    swatch: '#191426',
    ink: '#f2eefa',
  },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

/** Null is a real value: follow the system rather than choosing. */
export type ThemeChoice = ThemeId | null;

export const THEME_COOKIE = 'pt_theme';

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}

/**
 * Which of the two written polarities a generated theme is a version of.
 *
 * Re-exported rather than restated: the generator owns it, and a type-only
 * import costs nothing at build time, so the picker can name a mode without
 * pulling a hundred hex values into the browser.
 */
import type { ThemeMode } from '@/lib/theme/reference';

export type { ThemeMode };

/**
 * What somebody chose, read out of the one string that holds it.
 *
 * Three shapes, because there are three different things a person can have
 * chosen and one column to keep them in:
 *
 *   `system`    -- nothing chosen. Follow the machine, which is not the same
 *                  as choosing light.
 *   `written`   -- one of the four palettes written out in app/globals.css.
 *                  An account holding one renders exactly as it did, which is
 *                  what this shape is for.
 *   `generated` -- a mode and a colour, or a mode and none. What the picker
 *                  writes from now on.
 *
 * The string is `dark`, or `dark:284`, or `lightbox:155`, or a theme's name.
 * One column, and a cookie that keeps working, because widening the column
 * would have meant a migration for something that is already a short piece of
 * text.
 *
 * A mode with no colour and the written theme it equals are the same string --
 * `lightbox` reads back as the written one -- because they are the same
 * palette, and two spellings of one theme would be two things to keep in step.
 */
export type Theme =
  | { kind: 'system' }
  | { kind: 'written'; id: ThemeId }
  | { kind: 'generated'; mode: ThemeMode; hue: number | null };

/** The shape the picker works in: a polarity, and a colour or none. */
export type GeneratedTheme = Extract<Theme, { kind: 'generated' }>;

export const SYSTEM_THEME: Theme = { kind: 'system' };

/** Degrees, on the circle, as a whole number. */
function wrapHue(value: number): number {
  return Math.round(((value % 360) + 360) % 360) % 360;
}

export function parseTheme(value: string | null | undefined): Theme {
  if (!value) return SYSTEM_THEME;

  const text = value.trim().toLowerCase();
  if (isThemeId(text)) return { kind: 'written', id: text };

  const [mode, hue] = text.split(':');
  if (mode !== 'light' && mode !== 'dark' && mode !== 'lightbox' && mode !== 'darkroom')
    return SYSTEM_THEME;
  if (hue === undefined) return { kind: 'generated', mode, hue: null };

  const degrees = Number(hue);
  if (!Number.isFinite(degrees)) return SYSTEM_THEME;
  return { kind: 'generated', mode, hue: wrapHue(degrees) };
}

/** The string to store. Null means store nothing: follow the system. */
export function formatTheme(theme: Theme): string | null {
  if (theme.kind === 'system') return null;
  if (theme.kind === 'written') return theme.id;
  return theme.hue === null ? theme.mode : `${theme.mode}:${wrapHue(theme.hue)}`;
}

/** The written theme this is, if it is one. Null for the system and for a hue. */
export function writtenId(theme: Theme): ThemeId | null {
  return theme.kind === 'written' ? theme.id : null;
}

/**
 * Which mode a theme is, whatever shape it is stored in.
 *
 * A written theme reports the one it belongs to: Paper is light, Ink and Dusk
 * are dark, and Lightbox is its own, because a bench of one polarity under
 * sheets of the other is neither. A theme nobody has chosen reports light,
 * which is what the switch should be sitting on before the machine's own
 * preference is readable.
 */
export function modeOf(theme: Theme): ThemeMode {
  if (theme.kind === 'generated') return theme.mode;
  if (theme.kind === 'system') return 'light';
  if (theme.id === 'lightbox') return 'lightbox';
  if (theme.id === 'darkroom') return 'darkroom';
  return THEMES.find((written) => written.id === theme.id)?.scheme ?? 'light';
}

/** The colour a theme is, in degrees, or null for one with no colour. */
export function hueOf(theme: Theme): number | null {
  return theme.kind === 'generated' ? theme.hue : null;
}

/**
 * A room, as the picker asks for it: two questions, not one.
 *
 * Light or dark is the polarity. Solid or lightbox is the surface -- whether
 * the app is a flat page or a set of sheets floating on a lit bench. They are
 * independent, so all four combinations exist and each one takes a colour.
 *
 * It used to be one list of three: light, dark, and lightbox as a third thing
 * that was "both at once". That was true of the theme and false of the
 * question -- it made lightbox a polarity you could not be light or dark
 * inside of, and there was no way to ask for the dark one at all.
 *
 * In solid the polarity decides everything. In lightbox the bench is dark
 * either way and the polarity decides only what a SHEET is made of: lit paper,
 * or smoked glass.
 */
export const THEME_POLARITIES: readonly { id: Polarity; label: string; mood: string }[] = [
  { id: 'light', label: 'Light', mood: 'Warm, printed, quiet' },
  { id: 'dark', label: 'Dark', mood: 'Near-black, low chroma' },
];

export const THEME_SURFACES: readonly { id: Surface; label: string; mood: string }[] = [
  { id: 'solid', label: 'Solid', mood: 'One flat ground, edge to edge' },
  { id: 'lightbox', label: 'Lightbox', mood: 'Sheets floating on a lit bench' },
];

export type Polarity = 'light' | 'dark';
export type Surface = 'solid' | 'lightbox';

/** The two answers, as the one mode everything downstream keys off. */
export function modeFor(polarity: Polarity, surface: Surface): ThemeMode {
  if (surface === 'solid') return polarity;
  return polarity === 'light' ? 'lightbox' : 'darkroom';
}

/**
 * The four rooms as one list, for the places that need to name or offer a room
 * rather than ask the two questions -- the command palette, and the swatch
 * table on /dev/ui. The picker itself uses the two axes above, because two
 * questions are what it asks.
 */
export const THEME_ROOMS: readonly { id: ThemeMode; label: string; mood: string }[] = [
  { id: 'light', label: 'Light', mood: 'Warm, printed, quiet' },
  { id: 'dark', label: 'Dark', mood: 'Near-black, low chroma' },
  { id: 'lightbox', label: 'Lightbox', mood: 'Lit sheets on a dark bench' },
  { id: 'darkroom', label: 'Darkroom', mood: 'Smoked glass on the same bench' },
];

/** And back again, for putting the switch where the current theme is. */
export function partsOf(mode: ThemeMode): { polarity: Polarity; surface: Surface } {
  if (mode === 'lightbox') return { polarity: 'light', surface: 'lightbox' };
  if (mode === 'darkroom') return { polarity: 'dark', surface: 'lightbox' };
  return { polarity: mode, surface: 'solid' };
}

/**
 * The five colours the picker offers.
 *
 * Presets rather than the only choices: the wheel in #427 writes the same
 * value these do, and these are here because most people want a colour rather
 * than a particular colour. Plum is Dusk's own hue, so dark with plum is the
 * theme that shipped, to within a rounding step.
 */
export const THEME_COLOURS = [
  { id: 'plum', label: 'Plum', hue: 298 },
  { id: 'blue', label: 'Blue', hue: 260 },
  { id: 'green', label: 'Green', hue: 155 },
  { id: 'orange', label: 'Orange', hue: 65 },
  { id: 'red', label: 'Red', hue: 25 },
] as const;

export type ThemeColourId = (typeof THEME_COLOURS)[number]['id'];

/** The attribute holding the whole choice, so a client can read it back. */
export const THEME_CHOICE_ATTRIBUTE = 'data-theme-choice';

/**
 * A year. The cookie is a mirror of the stored setting, not the source of
 * truth -- it exists so the server can put the right `data-theme` on <html>
 * in the first byte it sends.
 *
 * A theme that flashes white before going dark is worse than no dark mode, and
 * that flash is exactly what you get when the choice is only readable after
 * hydration.
 */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
