/**
 * The numbers on /dev/ui are copied from app/globals.css, and a copy is wrong
 * within a month unless something checks it. This reads the stylesheet the
 * way scripts/check-ui.ts does and holds the page's table to it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ANATOMY_FRAMES,
  CONTROL_H_POINTER,
  DIAL,
  ICON_STROKE,
  RADII,
  ROW_HEIGHT,
  Z_LADDER,
} from '../app/dev/ui/measurements';
import { ALL_LAWS, LAW_GROUPS } from '../app/dev/ui/laws';

const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');

/** `1.25rem` or `20px` to px. */
function px(value: string): number {
  const number = parseFloat(value);
  return value.trim().endsWith('rem') ? Math.round(number * 16) : Math.round(number);
}

/** The value a variable holds inside a `[data-density='x']` block. */
function dial(density: string, variable: string, from = 0): string {
  const rest = css.slice(from);
  const block = new RegExp(`\\[data-density='${density}'\\]\\s*\\{([^}]*)\\}`).exec(rest);
  if (!block) throw new Error(`No ${density} block`);
  const line = new RegExp(`${variable}:\\s*([^;]+);`).exec(block[1]);
  if (!line) throw new Error(`${variable} not in ${density}`);
  return line[1];
}

describe('the density dial on /dev/ui', () => {
  const densities = ['comfortable', 'snug', 'dense'] as const;

  it.each(DIAL)('$variable matches globals.css', ({ variable, px: expected }) => {
    densities.forEach((density, index) => {
      expect(px(dial(density, variable))).toBe(expected[index]);
    });
  });

  it('control height from 40rem up matches the pointer override', () => {
    const at = css.indexOf('@media (min-width: 40rem)');
    expect(at).toBeGreaterThan(-1);
    densities.forEach((density, index) => {
      expect(px(dial(density, '--control-h', at))).toBe(CONTROL_H_POINTER[index]);
    });
  });

  it('a row costs one line of text-ui plus the row padding', () => {
    const size = /--text-ui:\s*(\d+)px/.exec(css);
    const leading = /--text-ui--line-height:\s*([\d.]+)/.exec(css);
    if (!size || !leading) throw new Error('text-ui is not on the scale');
    const line = Number(size[1]) * Number(leading[1]);
    densities.forEach((density, index) => {
      expect(Math.round(line + 2 * px(dial(density, '--row-y')))).toBe(ROW_HEIGHT[index]);
    });
  });
});

describe('the fixed measurements on /dev/ui', () => {
  it('the two radii match the tokens', () => {
    const card = /--radius-card:\s*([^;]+);/.exec(css);
    const control = /--radius-control:\s*([^;]+);/.exec(css);
    if (!card || !control) throw new Error('radii missing');
    expect(RADII.find((r) => r.name === 'rounded-card')?.px).toBe(px(card[1]));
    expect(RADII.find((r) => r.name === 'rounded-control')?.px).toBe(px(control[1]));
  });

  it('the z ladder on the page is the one in globals.css', () => {
    const rungs = [...css.matchAll(/^\s*--z-([a-z-]+):\s*(\d+);/gm)].map(([, name, z]) => ({
      utility: `z-${name}`,
      z,
    }));
    expect(rungs).toEqual(Z_LADDER.map(({ z, utility }) => ({ utility, z })));
    rungs.forEach(({ utility }) => {
      expect(css).toContain(`@utility ${utility} {`);
    });
  });

  it('the grain sits on the top rung', () => {
    const grain = /body::before\s*\{[^}]*z-index:\s*var\(--z-([a-z-]+)\)/.exec(css);
    if (!grain) throw new Error('grain is not on a rung');
    expect(Z_LADDER.at(-1)?.utility).toBe(`z-${grain[1]}`);
  });

  it('the icon stroke is the one the shell draws', () => {
    // The shell's own convention, read from its most-used component rather
    // than asserted: the number on the page is whatever the rail draws.
    const rail = readFileSync(join(process.cwd(), 'components/shell/app-shell.tsx'), 'utf8');
    const strokes = [...rail.matchAll(/strokeWidth=\{([\d.]+)\}/g)].map((m) => Number(m[1]));
    const commonest = [...new Set(strokes)].sort(
      (a, b) => strokes.filter((s) => s === b).length - strokes.filter((s) => s === a).length,
    )[0];
    expect(commonest).toBe(ICON_STROKE);
  });
});

describe('the widths the page anatomies are drawn at', () => {
  const phone = ANATOMY_FRAMES.find((frame) => frame.id === 'phone')!;
  const laptop = ANATOMY_FRAMES.find((frame) => frame.id === 'laptop')!;

  it('the phone frame is narrower than the breakpoint that gives a control a pointer', () => {
    // The narrowest width globals.css changes anything at -- 40rem today,
    // where the dial test above reads the pointer control heights. Below it a
    // control is sized for a thumb, and a phone drawing sitting above it would
    // be showing the pointer dial under a label saying phone.
    const widths = [...css.matchAll(/@media \(min-width:\s*([\d.]+)rem\)/g)].map((match) =>
      px(`${match[1]}rem`),
    );
    if (widths.length === 0) throw new Error('no width media query in globals.css');
    expect(phone.width).toBeLessThan(Math.min(...widths));
  });

  it('the laptop frame is at least the width the filter rail becomes a column at', () => {
    // Tailwind's own breakpoints, which nothing here overrides -- the check
    // below is what keeps that true.
    expect(css).not.toContain('--breakpoint-');
    const breakpoints: Record<string, number> = {
      sm: 640,
      md: 768,
      lg: 1024,
      xl: 1280,
      '2xl': 1536,
    };

    // The widest thing the app's layout waits for: the rail stops being a
    // sheet over the page and becomes a column beside it. A laptop frame
    // narrower than that would draw a phone's rail and call it a laptop.
    const rail = readFileSync(join(process.cwd(), 'components/shell/left-rail.tsx'), 'utf8');
    const column = /'hidden shrink-0 ([a-z2]+):block/.exec(rail);
    if (!column) throw new Error('the rail no longer becomes a column at a breakpoint');
    const at = breakpoints[column[1]!];
    expect(at).toBeGreaterThan(0);
    expect(laptop.width).toBeGreaterThanOrEqual(at);
  });

  it('both frames scale to a whole number of pixels', () => {
    ANATOMY_FRAMES.forEach((frame) => {
      expect(Number.isInteger(frame.width * frame.scale)).toBe(true);
      expect(Number.isInteger(frame.height * frame.scale)).toBe(true);
    });
  });
});

describe('the laws', () => {
  it('are numbered once, contiguously, and every one is in exactly one group', () => {
    const numbers = ALL_LAWS.map((law) => law.n);
    expect(numbers).toEqual(numbers.map((_, index) => index + 1));
    const grouped = LAW_GROUPS.flatMap((group) => group.laws.map((law) => law.n)).sort(
      (a, b) => a - b,
    );
    expect(grouped).toEqual(numbers);
  });
});
