import { generatePalette } from '@/lib/theme/palette';
import type { Theme, ThemeId } from '@/lib/theme';

/**
 * Putting a chosen theme onto the document.
 *
 * Two pieces, because a theme is two things now. The attribute picks one of
 * the written blocks in app/globals.css, which is where the polarity lives --
 * `color-scheme`, the grain, and the whole cascade of scope defaults. The
 * style is the `--c-*` values, and it goes on the element as an inline style
 * rather than into a stylesheet so that it wins without a specificity
 * argument and so that it arrives in the same byte the attribute does.
 *
 * A theme that flashes the wrong colour before settling is worse than one
 * colour, and that flash is exactly what you get if either half is applied
 * after hydration.
 */

/** The `data-theme` a choice renders under. Undefined means follow the system. */
export function themeAttribute(theme: Theme): ThemeId | undefined {
  if (theme.kind === 'system') return undefined;
  if (theme.kind === 'written') return theme.id;
  // A generated theme borrows the written block of its own polarity: light is
  // Paper's and dark is Ink's. With no colour that is the whole story and
  // nothing else is written; with a colour the tokens below paint over it.
  return theme.mode === 'light' ? 'paper' : 'ink';
}

/**
 * The generated `--c-*` tokens, as a style object, or undefined when there are
 * none to write.
 *
 * Undefined for the system and for a written theme, and for a mode with no
 * colour -- light with no colour is Paper and dark with no colour is Ink, both
 * of which globals.css already says better than a hundred inline declarations
 * would.
 */
export function themeStyle(theme: Theme): Record<string, string> | undefined {
  if (theme.kind !== 'generated' || theme.hue === null) return undefined;
  return generatePalette(theme.mode, theme.hue);
}
