import type { Theme } from '../theme';
import { themeAttribute, themeStyle } from '../theme/apply';

/**
 * The expression that puts a theme on a page, built in Node for a browser
 * driven over the DevTools protocol (scripts/shoot.ts, the phone checks in
 * tests/interaction/).
 *
 * The browser has no module loader in a CDP evaluate, so the palette is
 * generated here and the values travel as literals. Same two halves the
 * root layout writes: the attribute for the polarity, the tokens for the
 * colour.
 */
export function themeExpression(theme: Theme): string {
  const attribute = themeAttribute(theme);
  const style = themeStyle(theme) ?? {};
  const declarations = Object.entries(style)
    .map(([token, value]) => `${token}:${value}`)
    .join(';');

  return [
    'var r=document.documentElement;',
    attribute ? `r.setAttribute('data-theme','${attribute}');` : "r.removeAttribute('data-theme');",
    `r.setAttribute('style',${JSON.stringify(declarations)});`,
  ].join('');
}
