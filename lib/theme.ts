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
    // The one theme whose page and cards disagree: the bench is dark, so the
    // picker's swatch and the scheme it reports both describe the bench.
    scheme: 'dark',
    swatch: '#0d1219',
    ink: '#e7ebf1',
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
 *                  Lightbox is the reason this shape survives: its page and
 *                  its cards are opposite polarities, so it cannot be said as
 *                  a mode and a colour at all. Paper, Ink and Dusk stay here
 *                  too, so an account holding one renders exactly as it did.
 *   `generated` -- a mode and a colour, or a mode and none. What the picker
 *                  writes from now on.
 *
 * The string is `dark`, or `dark:284`, or a theme's name. One column, and a
 * cookie that keeps working, because widening the column would have meant a
 * migration for something that is already a short piece of text.
 */
export type Theme =
  | { kind: 'system' }
  | { kind: 'written'; id: ThemeId }
  | { kind: 'generated'; mode: ThemeMode; hue: number | null };

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
  if (mode !== 'light' && mode !== 'dark') return SYSTEM_THEME;
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
 * A year. The cookie is a mirror of the stored setting, not the source of
 * truth -- it exists so the server can put the right `data-theme` on <html>
 * in the first byte it sends.
 *
 * A theme that flashes white before going dark is worse than no dark mode, and
 * that flash is exactly what you get when the choice is only readable after
 * hydration.
 */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
