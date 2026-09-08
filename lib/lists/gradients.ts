/**
 * Auto-assigned list swatches. Stored in item_lists.color as a CSS gradient
 * string (or a legacy solid hex). Callers should use listSwatchStyle() so both
 * formats render correctly.
 */

export const LIST_GRADIENTS = [
  'linear-gradient(135deg, #4A9DD4 0%, #2F6F6A 100%)',
  'linear-gradient(135deg, #FF8A4C 0%, #E2725B 100%)',
  'linear-gradient(135deg, #6A82FB 0%, #9B72CF 100%)',
  'linear-gradient(135deg, #3FA37A 0%, #C9A227 100%)',
  'linear-gradient(135deg, #FF6B9D 0%, #E2725B 100%)',
  'linear-gradient(160deg, #2F6F6A 0%, #4A9DD4 55%, #6A82FB 100%)',
  'linear-gradient(120deg, #C9A227 0%, #FF8A4C 100%)',
  'linear-gradient(145deg, #9B72CF 0%, #FF6B9D 100%)',
  'linear-gradient(135deg, #5B8C5A 0%, #2F6F6A 100%)',
  'linear-gradient(150deg, #4A9DD4 0%, #6A82FB 50%, #9B72CF 100%)',
  'linear-gradient(135deg, #E2725B 0%, #C9A227 100%)',
  'linear-gradient(125deg, #6B6B66 0%, #4A9DD4 100%)',
] as const;

export type ListGradient = (typeof LIST_GRADIENTS)[number];

export function isListGradient(value: string): value is ListGradient {
  return (LIST_GRADIENTS as readonly string[]).includes(value);
}

/** Prefer an unused gradient for this user; wrap around randomly when all taken. */
export function pickListGradient(used: readonly (string | null | undefined)[]): ListGradient {
  const taken = new Set(used.filter((value): value is string => Boolean(value)));
  const available = LIST_GRADIENTS.filter((gradient) => !taken.has(gradient));
  const pool = available.length > 0 ? available : [...LIST_GRADIENTS];
  const index = Math.floor(Math.random() * pool.length);
  return pool[index]!;
}

/**
 * The swatch for something with no colour chosen.
 *
 * A literal rather than a token on purpose: it stands in for a *user's* colour,
 * which is data and does not follow the theme, so a themed grey here would be
 * the only swatch in the row that changed when the theme did. It is named
 * because it was written out in four places, one of which had drifted.
 */
export const UNSET_SWATCH = '#cfcfc8';

/** CSS style for a list color cell — supports gradients and legacy solid hex. */
export function listSwatchStyle(color: string | null | undefined): {
  backgroundImage?: string;
  backgroundColor?: string;
} {
  if (!color) return { backgroundColor: UNSET_SWATCH };
  if (color.includes('gradient')) return { backgroundImage: color };
  return { backgroundColor: color };
}
