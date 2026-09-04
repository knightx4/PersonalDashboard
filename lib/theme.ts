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
    id: 'riso',
    label: 'Riso',
    mood: 'Cream and halftone',
    scheme: 'light',
    swatch: '#f6f2e8',
    ink: '#191713',
  },
  {
    id: 'lightbox',
    label: 'Lightbox',
    mood: 'Lit page, dark bench',
    scheme: 'light',
    swatch: '#101317',
    ink: '#e4e7ec',
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

export function parseTheme(value: string | null | undefined): ThemeChoice {
  return isThemeId(value) ? value : null;
}

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
