import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatTheme, parseTheme, skyOf, auroraFor, isAurora } from '@/lib/theme';
import { themeAttribute, themeStyle } from '@/lib/theme/apply';
import { readTheme, THEME_SELECTORS } from '@/lib/theme/css';
import { MEANING_FLOOR, meaningGaps } from '@/lib/theme/palette';
import { parseHex, relativeLuminance } from '@/lib/theme/oklch';
import { DEFAULT_SKY, SKIES, SKY_IDS, skyTokens, type SkyPolarity } from '@/lib/theme/sky';

/**
 * Aurora's skies are hand-picked colours laid over a written block, so two
 * things can go wrong: the default sky drifting from the block it claims to
 * be, and a sky that looks right and reads badly. The second is measured
 * where scripts/check-contrast.ts cannot look -- over the pools, which is
 * where the sky is brightest and the glass is hardest to read through.
 */

const CSS = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
const BLOCK: Record<SkyPolarity, Record<string, string>> = {
  night: readTheme(CSS, THEME_SELECTORS.aurora),
  dawn: readTheme(CSS, THEME_SELECTORS.dawn),
};

type Rgb = [number, number, number];

/** `#rrggbb` or `rgb(r g b / a)`, as a colour and how much of it covers. */
function parse(value: string): { rgb: Rgb; alpha: number } {
  if (value.startsWith('#')) return { rgb: parseHex(value).map((c) => c * 255) as Rgb, alpha: 1 };
  const parts = value.match(/[\d.]+/g)!.map(Number);
  return { rgb: [parts[0]!, parts[1]!, parts[2]!], alpha: parts[3] ?? 1 };
}

function over(top: string, alpha: number, under: Rgb): Rgb {
  const colour = parse(top);
  const a = colour.alpha * alpha;
  return colour.rgb.map((channel, i) => channel * a + under[i]! * (1 - a)) as Rgb;
}

function hex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

function ratio(a: Rgb, b: Rgb): number {
  const x = relativeLuminance(hex(a));
  const y = relativeLuminance(hex(b));
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * The strongest a pool lands on the bench: the largest share the wash in
 * globals.css gives any pool (34%), times the theme's lift.
 */
const STRONGEST = 0.34;

/** The near pool each workspace paints in Aurora, read out of globals.css. */
const WORKSPACE_POOLS = [
  ...CSS.matchAll(/\[data-theme='aurora'\] \[data-workspace='[a-z]+'\],\n\[data-theme='dawn'\] \[data-workspace='[a-z]+'\] \{ --c-wash-near: (#[0-9a-f]{6}); \}/g),
].map((match) => match[1]!);

const GLASS = ['--c-surface', '--c-raised', '--c-canvas', '--c-sunken'] as const;

function theme(polarity: SkyPolarity, id: (typeof SKY_IDS)[number]): Record<string, string> {
  return { ...BLOCK[polarity], ...skyTokens(polarity, id) };
}

describe('the default sky', () => {
  it('is the Aurora and Dawn blocks as written', () => {
    const borealis = SKIES.find((sky) => sky.id === DEFAULT_SKY)!;
    for (const polarity of ['night', 'dawn'] as const) {
      const side = borealis[polarity];
      const block = BLOCK[polarity];
      expect(block['--c-page']).toBe(side.bench);
      expect(block['--c-wash-near']).toBe(side.pools.near);
      expect(block['--c-wash-mid']).toBe(side.pools.mid);
      expect(block['--c-wash-far']).toBe(side.pools.far);
      expect(block['--c-wash-floor']).toBe(side.pools.floor);
      expect(block['--c-accent-base']).toBe(side.accent);
      expect(block['--c-accent-hover']).toBe(side.accentHover);
      expect(block['--c-accent-tint-base']).toBe(side.accentTint);
    }
  });

  it('writes no tokens of its own', () => {
    expect(skyTokens('night', DEFAULT_SKY)).toEqual({});
    expect(themeStyle(parseTheme('aurora'))).toBeUndefined();
  });
});

describe('every sky', () => {
  it('reads all eight workspace pools out of globals.css', () => {
    expect(WORKSPACE_POOLS).toHaveLength(8);
  });

  it('has a night side and a dawn side, in flat colours', () => {
    expect(SKIES.map((sky) => sky.id)).toEqual([...SKY_IDS]);
    for (const sky of SKIES) {
      for (const side of [sky.night, sky.dawn]) {
        const colours = [side.bench, side.accent, side.accentHover, side.accentTint, ...Object.values(side.pools)];
        for (const colour of colours) expect(colour).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('keeps night dark and dawn light', () => {
    for (const sky of SKIES) {
      expect(relativeLuminance(sky.night.bench), sky.id).toBeLessThan(0.01);
      expect(relativeLuminance(sky.dawn.bench), sky.id).toBeGreaterThan(0.75);
    }
  });

  it.each(['night', 'dawn'] as const)(
    'keeps its text readable on every glass, over the brightest point of every pool, at %s',
    (polarity) => {
      for (const id of SKY_IDS) {
        const vars = theme(polarity, id);
        const bench = parse(vars['--c-page']!).rgb;
        const lift = Number(vars['--wash-lift'] ?? 1);
        const pools = ['--c-wash-near', '--c-wash-mid', '--c-wash-far', '--c-wash-floor'];
        // The sky's own pools, and every workspace colour, which takes the
        // largest pool inside its workspace.
        const colours = [...pools.map((pool) => vars[pool]!), ...WORKSPACE_POOLS];
        const lit = [bench, ...colours.map((colour) => over(colour, Math.min(1, STRONGEST * lift), bench))];

        for (const ground of lit) {
          for (const glass of GLASS) {
            const sheet = over(vars[glass]!, 1, ground);
            for (const ink of ['--c-ink', '--c-ink-muted', '--c-accent-base', '--c-accent-hover']) {
              const value = ratio(parse(vars[ink]!).rgb, sheet);
              expect(value, `${polarity} ${id}: ${ink} on ${glass} over ${hex(ground)}`).toBeGreaterThanOrEqual(4.5);
            }
          }
        }
      }
    },
  );

  it('puts a readable label on its accent, and keeps the accent off the meaning colours', () => {
    for (const polarity of ['night', 'dawn'] as const) {
      for (const id of SKY_IDS) {
        const vars = theme(polarity, id);
        const label = ratio(parse(vars['--c-fill-ink']!).rgb, parse(vars['--c-accent-base']!).rgb);
        expect(label, `${polarity} ${id}`).toBeGreaterThanOrEqual(4.5);
        for (const { accent, meaning, gap } of meaningGaps(vars)) {
          // Well clear of the floor, not just over it: a sky is chosen by eye,
          // and a link that only nearly matches the delete button still reads
          // as the delete button.
          expect(gap, `${polarity} ${id}: ${accent} to ${meaning}`).toBeGreaterThan(MEANING_FLOOR * 3);
        }
      }
    }
  });
});

describe('choosing a sky', () => {
  it('stores the default sky as the bare theme, and any other by name', () => {
    expect(formatTheme(parseTheme('aurora:borealis'))).toBe('aurora');
    expect(formatTheme(parseTheme('aurora:polar'))).toBe('aurora:polar');
    expect(formatTheme(parseTheme('DAWN:Ember'))).toBe('dawn:ember');
  });

  it('keeps a renamed sky in Aurora rather than dropping the theme', () => {
    expect(parseTheme('aurora:somewhere')).toEqual({ kind: 'written', id: 'aurora' });
  });

  it('renders on its own block with its tokens inline', () => {
    const chosen = parseTheme('dawn:tide');
    expect(themeAttribute(chosen)).toBe('dawn');
    expect(themeStyle(chosen)).toEqual(skyTokens('dawn', 'tide'));
    expect(themeStyle(chosen)?.['--c-page']).toBe(SKIES.find((sky) => sky.id === 'tide')!.dawn.bench);
  });

  it('keeps the sky across Aurora and Dawn', () => {
    const night = auroraFor('dark', 'nebula');
    const day = auroraFor('light', skyOf(night));
    expect(formatTheme(day)).toBe('dawn:nebula');
    expect(isAurora(day)).toBe(true);
    expect(isAurora(parseTheme('lightbox'))).toBe(false);
  });
});
