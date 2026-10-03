/**
 * Note a065b91b: in the glass themes the note box and Ask Dash let too much
 * of the page through to be read. Floating panels there are frosted and
 * nearly opaque, and Ask Dash is one of them.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('app/globals.css', 'utf8');

/** The alpha a glass theme gives `.popover-panel`, or null when it sets none. */
function panelAlpha(theme: string): number | null {
  const rule = css.match(
    new RegExp(
      `\\[data-theme='${theme}'\\] \\.popover-panel \\{[^}]*background-color: rgb\\([^/]+/ ([0-9.]+)\\)`,
    ),
  );
  return rule ? Number(rule[1]) : null;
}

describe('floating panels in the glass themes', () => {
  it.each(['lightbox', 'darkroom', 'aurora', 'dawn'])('are nearly opaque in %s', (theme) => {
    expect(panelAlpha(theme)).toBeGreaterThanOrEqual(0.95);
  });

  it('include Ask Dash', () => {
    const source = readFileSync('components/shell/ask-dash.tsx', 'utf8');
    expect(source).toMatch(/<aside[^>]*className="popover-panel /);
  });
});
