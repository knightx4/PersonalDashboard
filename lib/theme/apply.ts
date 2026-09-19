import { generatePalette } from '@/lib/theme/palette';
import { formatTheme, parseTheme, THEME_CHOICE_ATTRIBUTE, type Theme, type ThemeId } from '@/lib/theme';
import { TOKEN_NAMES } from '@/lib/theme/reference';
import { colourwayById, paintsWash, WASH_LIFT } from '@/lib/theme/colourway';

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
  // A generated theme borrows the written block of its own mode: light is
  // Paper's, dark is Ink's, and the two glass rooms are their own. With no colour that is
  // the whole story and nothing else is written; with a colour the tokens
  // below paint over it. Lightbox needs its block for more than the polarity
  // -- the glow round a sheet, the wash across the bench and the two
  // colour-schemes are all in there, and none of them are `--c-*` tokens.
  if (theme.mode === 'light') return 'paper';
  if (theme.mode === 'dark') return 'ink';
  return theme.mode === 'lightbox' ? 'lightbox' : 'darkroom';
}

/**
 * The generated `--c-*` tokens, as a style object, or undefined when there are
 * none to write.
 *
 * Undefined for the system and for a written theme, and for a mode with no
 * colour -- light with no colour is Paper, dark with no colour is Ink and
 * lightbox with no colour is Lightbox, all three of which globals.css already
 * says better than a hundred inline declarations would.
 */
export function themeStyle(theme: Theme): Record<string, string> | undefined {
  if (theme.kind !== 'generated' || theme.hue === null) return undefined;
  const palette = generatePalette(theme.mode, theme.hue, theme.way);

  // `--wash-lift` is the one thing a colourway carries that is not a colour,
  // so it is added here rather than inside the palette: the generator's tables
  // hold hex and nothing else, and the contrast script walks them expecting
  // that. Written only where the wash is painted.
  const way = colourwayById(theme.way);
  if (!way || !paintsWash(theme.mode)) return palette;
  return { ...palette, [WASH_LIFT]: String(way.lift) };
}

/**
 * Put a theme onto the live document.
 *
 * The document is the store, the same arrangement the density dial already
 * uses: the server rendered the choice onto <html>, this writes over it, and
 * anything that wants to know what is on screen reads it back from there
 * rather than from a second copy that can disagree.
 *
 * Every token is cleared before the new ones go on, so leaving a previewed
 * colour and landing on a written theme takes the colour off rather than
 * leaving half of it behind.
 */
export function applyTheme(root: HTMLElement, theme: Theme): void {
  const attribute = themeAttribute(theme);
  if (attribute) root.setAttribute('data-theme', attribute);
  else root.removeAttribute('data-theme');

  const choice = formatTheme(theme);
  if (choice) root.setAttribute(THEME_CHOICE_ATTRIBUTE, choice);
  else root.removeAttribute(THEME_CHOICE_ATTRIBUTE);

  const style = themeStyle(theme);
  for (const token of [...TOKEN_NAMES, WASH_LIFT]) {
    const value = style?.[token];
    if (value) root.style.setProperty(token, value);
    else root.style.removeProperty(token);
  }
}

/**
 * What is on the document right now. The picker's starting point after mount.
 *
 * Named for the document rather than for the theme because lib/theme/css.ts
 * already has a readTheme, and that one reads a stylesheet.
 */
export function themeOnDocument(root: HTMLElement): Theme {
  return parseTheme(root.getAttribute(THEME_CHOICE_ATTRIBUTE));
}

/**
 * Whether the account's stored theme should be written onto the document.
 *
 * There is exactly one thing this repair is for, and it is worth saying
 * narrowly because saying it broadly is what broke the picker: a device that
 * has never seen this account has no cookie, so the server rendered no choice
 * at all and the first paint is the system default rather than the theme the
 * account holds. Putting it on -- and writing the cookie back -- makes this
 * page right and the next one too.
 *
 * A document that already carries a choice is a different situation, and not
 * one the account gets to settle from here. The cookie is written on the same
 * tick as the click, while `stored` comes from a render that can be older than
 * the write it is answering; so when the two disagree, the document is the
 * newer fact and overwriting it puts the previous theme back a moment after
 * the person chose against it. That is the whole of note bce3f7e5: every
 * choice snapping straight back to Lightbox, because the stale value was not
 * only re-applied but re-saved, to the cookie and to the account.
 *
 * The cost is that a theme chosen on another device no longer reaches this one
 * while its own cookie still holds a real choice. That is the right way round:
 * a device keeping the theme it was last given is a year-old mirror being
 * slow, and the alternative is a picker that cannot be used at all.
 */
export function shouldRepairTheme(onDocument: string | null, stored: string | null): boolean {
  // Following the system is not a stored choice -- it is the account declining
  // to say, which is no reason to touch a document that may know better.
  if (!stored) return false;
  return onDocument === null;
}
