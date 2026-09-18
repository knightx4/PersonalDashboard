/**
 * Reading the written themes back out of app/globals.css.
 *
 * Paper, Ink, Lightbox and Dusk are hand-written blocks of CSS variables, and
 * two things need them as data: the contrast checker, which measures the real
 * values rather than a copy of them, and the palette generator, whose
 * reference tables are checked against this file by a test. Both would
 * otherwise carry their own transcription of a hundred hex values, and a
 * transcription drifts the first time somebody edits a token.
 *
 * Node only -- the caller supplies the file's text, so this stays a pure
 * function and the reading of the file stays with whoever can do it.
 */

/** The declarations of one block, by variable name, unresolved. */
export type Vars = Record<string, string>;

/** Paper is `:root` as well, so every other theme inherits what it does not set. */
export const PAPER_SELECTOR = ":root,\n[data-theme='paper']";

export const THEME_SELECTORS: Record<string, string> = {
  paper: PAPER_SELECTOR,
  ink: "[data-theme='ink']",
  lightbox: "[data-theme='lightbox']",
  darkroom: "[data-theme='darkroom']",
  dusk: "[data-theme='dusk']",
};

/** The declarations inside one selector block. */
export function blockFor(css: string, selector: string): Vars {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`No block for ${selector}`);
  const open = css.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = css.slice(open + 1, end);
  const vars: Vars = {};
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    vars[match[1]] = match[2].trim();
  }
  return vars;
}

/**
 * Follow `var(--x)` chains until a literal comes out.
 *
 * The scope tokens are written as references -- `--c-page-ink: var(--c-ink)`
 * in every theme that does not need a page palette of its own -- so a theme's
 * table has to be flattened before anything in it can be measured or
 * generated from. Resolving per theme is the point: the same declaration lands
 * on a different literal in each one, which is exactly what makes those
 * defaults free.
 */
export function resolveVars(vars: Vars): Vars {
  const out: Vars = {};
  for (const name of Object.keys(vars)) {
    let value = vars[name];
    // Deep enough for any chain globals.css has a reason to contain, and a
    // hard stop rather than a hang if someone writes a loop.
    for (let hop = 0; hop < 10 && value.startsWith('var('); hop += 1) {
      const referenced = value.slice(4, -1).trim();
      const next = vars[referenced];
      if (next === undefined) throw new Error(`${name} points at undefined ${referenced}`);
      value = next;
    }
    if (value.startsWith('var(')) throw new Error(`${name} does not settle on a value`);
    out[name] = value;
  }
  return out;
}

/**
 * One theme's full table: what it declares, over what Paper declares, flattened.
 *
 * Merged before resolving, so a theme that overrides `--c-ink` also moves
 * every default written as `var(--c-ink)` -- which is the whole mechanism the
 * scopes rely on.
 */
export function readTheme(css: string, selector: string): Vars {
  return resolveVars({ ...blockFor(css, PAPER_SELECTOR), ...blockFor(css, selector) });
}
