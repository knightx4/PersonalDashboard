/**
 * Every text/ground pair, in every theme, measured.
 *
 * Five themes is five times the surface area for a contrast bug to hide in,
 * and "it looked fine on my screen" is how all of them get shipped. This reads
 * the real values out of app/globals.css rather than a copy, so a token edited
 * without re-running it fails here rather than in someone's eyes.
 *
 *   npx tsx scripts/check-contrast.ts
 *
 * Thresholds are WCAG 2.2 AA: 4.5:1 for text under 18px (which is every piece
 * of text in this app), 3:1 for icons, meaningful borders and focus rings.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAPER_SELECTOR, readTheme, THEME_SELECTORS, type Vars } from '../lib/theme/css';

const CSS = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');

const TEXT = 4.5;
const NON_TEXT = 3;

const PAPER = readTheme(CSS, PAPER_SELECTOR);

const THEMES: Record<string, Vars> = Object.fromEntries(
  Object.entries(THEME_SELECTORS).map(([name, selector]) => [name, readTheme(CSS, selector)]),
);

type Rgb = [number, number, number];
type Rgba = { rgb: Rgb; alpha: number };

/**
 * `#rrggbb` or `rgb(r g b / a)`.
 *
 * The second form exists because Lightbox's sheets are translucent: they are
 * meant to pick up the bench they sit on rather than glare white over it. A
 * contrast figure for one of those is only true once it has been composited,
 * which is what `over` below is for.
 */
function parseColour(value: string): Rgba {
  const hex = value.trim().match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const parts = hex[1].match(/../g)!;
    return { rgb: parts.map((part) => parseInt(part, 16)) as Rgb, alpha: 1 };
  }
  const rgb = value
    .trim()
    .match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[/,]\s*([\d.]+)\s*)?\)$/i);
  if (rgb) {
    return {
      rgb: [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])],
      alpha: rgb[4] === undefined ? 1 : Number(rgb[4]),
    };
  }
  throw new Error(`Not a colour this script can measure: ${value}`);
}

/** Source-over: what the eye actually receives, which is what WCAG measures. */
function over(colour: Rgba, backdrop: Rgb): Rgb {
  if (colour.alpha >= 1) return colour.rgb;
  return colour.rgb.map((channel, index) =>
    channel * colour.alpha + backdrop[index] * (1 - colour.alpha),
  ) as Rgb;
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The ratio between `ink` and `ground`, with `bench` behind both.
 *
 * A translucent ground is composited over the bench and a translucent ink over
 * the composited ground. The bench is the page ground, which is the darkest
 * thing a sheet can sit on, so this is the worst case: a sheet stacked on
 * another sheet only ever comes out lighter than what is measured here.
 */
function ratio(ink: string, ground: string, bench: string): number {
  const behind = parseColour(bench);
  if (behind.alpha < 1) throw new Error(`The page ground must be opaque: ${bench}`);
  const groundRgb = over(parseColour(ground), behind.rgb);
  const x = luminance(over(parseColour(ink), groundRgb));
  const y = luminance(groundRgb);
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Every ground a sheet's ink can land on.
 *
 * --c-page is deliberately not in here. A theme may draw its page ground in
 * the opposite polarity from its cards -- Lightbox does -- and the ink that
 * lands there is the --c-page-* set, checked separately below. Leaving the
 * page in this list would have forced one ink to clear both, which is exactly
 * the constraint the two scopes exist to lift.
 */
const GROUNDS = ['--c-canvas', '--c-surface', '--c-raised', '--c-sunken'] as const;

type Check = { ink: string; grounds: readonly string[]; min: number; why: string };

const CHECKS: Check[] = [
  { ink: '--c-ink', grounds: GROUNDS, min: TEXT, why: 'primary text' },
  { ink: '--c-ink-muted', grounds: GROUNDS, min: TEXT, why: 'secondary text -- the only grey allowed to carry information' },
  // Decoration only: placeholders, disabled controls, redundant glyphs. Held to
  // the non-text bar deliberately, and the design language forbids putting
  // anything a reader would miss in it.
  { ink: '--c-ink-ghost', grounds: GROUNDS, min: NON_TEXT, why: 'decoration' },
  { ink: '--c-accent-base', grounds: [...GROUNDS, '--c-accent-tint-base'], min: TEXT, why: 'links, active state, primary button label' },
  { ink: '--c-accent-hover', grounds: GROUNDS, min: TEXT, why: 'link hover' },
  { ink: '--c-w-shopping', grounds: [...GROUNDS, '--c-w-shopping-tint'], min: TEXT, why: 'shopping accent' },
  { ink: '--c-w-jobs', grounds: [...GROUNDS, '--c-w-jobs-tint'], min: TEXT, why: 'jobs accent' },
  { ink: '--c-w-todo', grounds: [...GROUNDS, '--c-w-todo-tint'], min: TEXT, why: 'todo accent' },
  { ink: '--c-w-vault', grounds: [...GROUNDS, '--c-w-vault-tint'], min: TEXT, why: 'vault accent' },
  { ink: '--c-w-learn', grounds: [...GROUNDS, '--c-w-learn-tint'], min: TEXT, why: 'learn accent' },
  { ink: '--c-w-dev', grounds: [...GROUNDS, '--c-w-dev-tint'], min: TEXT, why: 'dev accent' },
  { ink: '--c-positive', grounds: [...GROUNDS, '--c-positive-tint'], min: TEXT, why: 'refunds and savings' },
  { ink: '--c-caution', grounds: [...GROUNDS, '--c-caution-tint'], min: TEXT, why: 'needs attention' },
  { ink: '--c-danger', grounds: [...GROUNDS, '--c-danger-tint'], min: TEXT, why: 'destructive and rejected' },
  // A control's border is often the only thing identifying it, so it owes 3:1
  // under WCAG 1.4.11. A container's border does not -- the container is also
  // identified by its fill and its contents -- which is why there are two
  // border tokens and only one of them is checked here.
  { ink: '--c-border-control', grounds: ['--c-surface', '--c-canvas', '--c-raised'], min: NON_TEXT, why: 'input borders and checkboxes' },
  // The shell -- sidebar and top bar -- is its own ground. In most themes it
  // is a shade of the surface; in Lightbox it is near-black under a lit page,
  // which is the whole reason these tokens exist.
  { ink: '--c-shell-ink', grounds: ['--c-shell'], min: TEXT, why: 'sidebar and top bar text' },
  { ink: '--c-shell-muted', grounds: ['--c-shell'], min: TEXT, why: 'sidebar secondary text' },
];

for (const stage of ['lead', 'submitted', 'process', 'final', 'offer', 'rejected'] as const) {
  CHECKS.push({
    ink: `--c-status-${stage}`,
    grounds: [`--c-status-${stage}-tint`, '--c-surface'],
    min: TEXT,
    why: `pipeline status: ${stage}`,
  });
}
// Ghosted is drained by carrying less ink -- it renders as an outline with no
// fill -- so it is checked against the surface it actually sits on.
CHECKS.push({
  ink: '--c-status-ghosted',
  grounds: ['--c-surface', '--c-canvas'],
  min: TEXT,
  why: 'pipeline status: ghosted (outline, no fill)',
});

/**
 * The page ground, and everything that can be drawn straight onto it.
 *
 * This is the other half of the two-scope arrangement in globals.css. A page
 * header, a bare link, a divider between two rows that are not in a card --
 * none of those sit on a sheet, so none of them use the inks above. In four
 * themes these tokens resolve to the same values as their sheet twins and this
 * block re-proves what the block above already proved, which is cheap. In
 * Lightbox it is the only thing standing between a black bench and unreadable
 * text on it.
 *
 * The accents are checked per workspace: the page ground is where a workspace
 * link actually lands, and four hues have to clear it, not one.
 */
const PAGE = ['--c-page'] as const;

CHECKS.push(
  { ink: '--c-page-ink', grounds: PAGE, min: TEXT, why: 'page-ground text' },
  { ink: '--c-page-ink-muted', grounds: PAGE, min: TEXT, why: 'secondary text on the page ground' },
  { ink: '--c-page-ink-ghost', grounds: PAGE, min: NON_TEXT, why: 'decoration on the page ground' },
  { ink: '--c-page-border-control', grounds: PAGE, min: NON_TEXT, why: 'input borders on the page ground' },
  { ink: '--c-page-positive', grounds: PAGE, min: TEXT, why: 'refunds and savings on the page ground' },
  { ink: '--c-page-caution', grounds: PAGE, min: TEXT, why: 'needs attention on the page ground' },
  { ink: '--c-page-danger', grounds: PAGE, min: TEXT, why: 'destructive on the page ground' },
  { ink: '--c-accent-base-lit', grounds: PAGE, min: TEXT, why: 'app accent on the page ground' },
  { ink: '--c-accent-hover-lit', grounds: PAGE, min: TEXT, why: 'app accent hover on the page ground' },
  { ink: '--c-w-shopping-lit', grounds: PAGE, min: TEXT, why: 'shopping accent on the page ground' },
  { ink: '--c-w-jobs-lit', grounds: PAGE, min: TEXT, why: 'jobs accent on the page ground' },
  { ink: '--c-w-todo-lit', grounds: PAGE, min: TEXT, why: 'todo accent on the page ground' },
  { ink: '--c-w-vault-lit', grounds: PAGE, min: TEXT, why: 'vault accent on the page ground' },
  { ink: '--c-w-learn-lit', grounds: PAGE, min: TEXT, why: 'learn accent on the page ground' },
  { ink: '--c-w-dev-lit', grounds: PAGE, min: TEXT, why: 'dev accent on the page ground' },
);

/**
 * The sheet accents, on the sheets they land on.
 *
 * `bg-accent` is a solid fill wearing --c-surface as its label, and a tint
 * chip is that accent on its own tint. Both were previously covered only for
 * the app's own accent; now that a workspace accent has a second, lit value
 * it is worth pinning the sheet value too, or a hue could be fixed for the
 * bench and quietly broken on a card.
 */
for (const hue of [
  '--c-w-shopping',
  '--c-w-jobs',
  '--c-w-todo',
  '--c-w-vault',
  '--c-w-learn',
  '--c-w-dev',
] as const) {
  CHECKS.push({
    ink: '--c-surface',
    grounds: [hue],
    min: TEXT,
    why: `${hue.replace('--c-w-', '')} button label on its solid fill`,
  });
}
CHECKS.push({
  ink: '--c-surface',
  grounds: ['--c-accent-base'],
  min: TEXT,
  why: 'primary button label on the app accent',
});

/** Dark ink on the count badge, which is a light amber in every theme. Read
 * from the token rather than repeated here, so the two cannot drift. */
const BADGE_INK = PAPER['--c-caution-fill-ink'];

let failures = 0;
let checked = 0;

for (const [name, vars] of Object.entries(THEMES)) {
  const bench = vars['--c-page'];
  if (!bench) throw new Error(`${name}: --c-page is not defined`);
  for (const check of CHECKS) {
    const ink = vars[check.ink];
    if (!ink) {
      console.error(`✗ ${name}: ${check.ink} is not defined`);
      failures += 1;
      continue;
    }
    for (const groundName of check.grounds) {
      const ground = vars[groundName];
      if (!ground) continue;
      checked += 1;
      const value = ratio(ink, ground, bench);
      if (value < check.min) {
        failures += 1;
        console.error(
          `✗ ${name}: ${check.ink} on ${groundName} is ${value.toFixed(2)}:1, needs ${check.min} — ${check.why}`,
        );
      }
    }
  }

  const badgeFill = vars['--c-caution-fill'];
  if (badgeFill) {
    checked += 1;
    const value = ratio(BADGE_INK, badgeFill, bench);
    if (value < TEXT) {
      failures += 1;
      console.error(
        `✗ ${name}: count badge ink on --c-caution-fill is ${value.toFixed(2)}:1, needs ${TEXT}`,
      );
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} contrast failure${failures === 1 ? '' : 's'} across ${checked} pairs.`);
  process.exit(1);
}

console.log(`✓ ${checked} text and non-text pairs clear WCAG AA across ${Object.keys(THEMES).length} themes.`);
