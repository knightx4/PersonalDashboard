/**
 * The four phone checks of docs/UI-QUALITY-SPEC.md, Part 5, at 390 pixels:
 *
 *   sideways   nothing scrolls sideways
 *   targets    every press target is at least 44 by 44 pixels
 *   dock       nothing a person can press sits under the dock
 *   contrast   text meets the floor check:contrast uses (4.5:1, 3:1 large)
 *
 * `checkPage` measures whatever page is open (./probe.ts does the measuring)
 * and returns one list of findings per check, each finding a line a person
 * can act on. scripts/check-phone.ts runs it on the gallery surfaces a change
 * touched; the tests beside this file run it on fixtures built to break each
 * check.
 */
import { themeExpression } from '../../lib/preview/theme-expression';
import { formatTheme, type Theme } from '../../lib/theme';
import type { Page } from './browser';
import { PROBE } from './probe';

export const CHECKS = ['sideways', 'targets', 'dock', 'contrast'] as const;
export type Check = (typeof CHECKS)[number];

/** What each check holds, for messages. */
export const CHECK_RULES: Record<Check, string> = {
  sideways: 'nothing scrolls sideways at 390px',
  targets: 'every press target is at least 44 by 44px',
  dock: 'nothing pressable sits under the dock',
  contrast: 'text meets 4.5:1 against its ground (3:1 when large or in a ghost ink)',
};

export const MIN_TARGET = 44;
/** check:contrast's thresholds (scripts/check-contrast.ts), with WCAG's large-text one. */
export const TEXT_FLOOR = 4.5;
export const LARGE_TEXT_FLOOR = 3;
/** --dock-h in app/globals.css, 4.875rem, for a page that does not define it. */
export const DOCK_FALLBACK = 78;
/**
 * The inks scripts/check-contrast.ts measures at its non-text 3:1 as
 * decoration. Text in one of them is held to 3:1 here too, so the two checks
 * agree on what the floor is.
 */
export const DECORATION_INKS = ['--c-ink-ghost', '--c-page-ink-ghost'];

export type Findings = Record<Check, string[]>;

type Measured = {
  sideways: {
    viewport: number;
    scrollWidth: number;
    scrolls: boolean;
    over: Array<{ what: string; left: number; right: number }>;
  };
  targets: { minimum: number; small: Array<{ what: string; width: number; height: number }> };
  dock: { height: number; under: Array<{ what: string; top: number; bottom: number; where: string }> };
  contrast: {
    faint: Array<{ what: string; ratio: number; floor: number; ink: string; ground: string }>;
    unmeasured: number;
  };
};

/** Runs the probe on the open page and returns what it measured. */
export async function measure(page: Page): Promise<Measured> {
  const options = {
    minTarget: MIN_TARGET,
    text: TEXT_FLOOR,
    largeText: LARGE_TEXT_FLOOR,
    dockFallback: DOCK_FALLBACK,
    decorationInks: DECORATION_INKS,
  };
  return page.evaluate<Measured>(`(${PROBE})(${JSON.stringify(options)})`);
}

/** Turns one measurement into findings, one line each. `label` prefixes the contrast lines. */
export function findingsOf(measured: Measured, label = ''): Findings {
  const prefix = label ? `${label}: ` : '';
  const { sideways, targets, dock, contrast } = measured;
  return {
    sideways: sideways.scrolls
      ? [
          `page is ${sideways.scrollWidth}px wide in a ${sideways.viewport}px viewport` +
            (sideways.over.length
              ? `; past the edge: ${sideways.over.map((o) => `${o.what} (${o.left} to ${o.right})`).join(', ')}`
              : ''),
        ]
      : [],
    targets: targets.small.map((t) => `${t.what} is ${t.width}×${t.height}px`),
    dock: dock.under.map(
      (d) => `${d.what} spans ${d.top} to ${d.bottom}px, under the ${dock.height}px dock (scrolled to the ${d.where})`,
    ),
    contrast: contrast.faint.map(
      (f) => `${prefix}${f.what} is ${f.ratio}:1 (${f.ink} on ${f.ground}), needs ${f.floor}:1`,
    ),
  };
}

/** Puts a theme on the open page the way the app's root layout does. */
export async function applyTheme(page: Page, theme: Theme): Promise<void> {
  await page.evaluate(`(function(){${themeExpression(theme)}return true})()`);
  await page.evaluate(`new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r)})})`);
}

/**
 * The four checks on the open page. Layout is measured once, in the theme the
 * page opened in; contrast is measured in each of `themes`, since a pair that
 * reads in light can vanish in dark. With no themes, contrast is measured as
 * the page stands.
 */
export async function checkPage(page: Page, themes: readonly Theme[] = []): Promise<Findings> {
  if (themes.length === 0) return findingsOf(await measure(page));
  let findings: Findings | null = null;
  for (const theme of themes) {
    await applyTheme(page, theme);
    const label = formatTheme(theme) ?? 'system';
    const got = findingsOf(await measure(page), label);
    if (!findings) findings = got;
    else findings.contrast.push(...got.contrast);
  }
  return findings!;
}
