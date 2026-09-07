/**
 * Density.
 *
 * Comfortable, snug, dense: one attribute on <html>, two CSS variables, and
 * every card's padding and every row's height follow. "How much do I want to
 * see at once" changes with what you are doing -- reading a note against
 * working a review queue of forty -- so it is one click in the top bar rather
 * than a setting on a settings page.
 *
 * Per device, in a cookie, and nowhere else. Unlike the theme it is not a fact
 * about the account: a laptop and a phone want different answers. The cookie
 * is what lets the server put `data-density` on <html> in the first byte, so
 * the page never renders comfortable and then snaps.
 *
 * No `server-only`: the picker is a client component and the layout is a
 * server one, and both need this list.
 */
export const DENSITIES = [
  { id: 'comfortable', label: 'Comfortable' },
  { id: 'snug', label: 'Snug' },
  { id: 'dense', label: 'Dense' },
] as const;

export type Density = (typeof DENSITIES)[number]['id'];

export const DENSITY_COOKIE = 'pt_density';
export const DENSITY_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isDensity(value: string | null | undefined): value is Density {
  return DENSITIES.some((density) => density.id === value);
}

/** Comfortable when nothing has been chosen: exactly what the app measured before the dial. */
export function parseDensity(value: string | null | undefined): Density {
  return isDensity(value) ? value : 'comfortable';
}
