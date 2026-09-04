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

const CSS = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');

const TEXT = 4.5;
const NON_TEXT = 3;

type Vars = Record<string, string>;

/** The declarations inside one selector block, by variable name. */
function blockFor(selector: string): Vars {
  const start = CSS.indexOf(selector);
  if (start === -1) throw new Error(`No block for ${selector}`);
  const open = CSS.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (let i = open; i < CSS.length; i += 1) {
    if (CSS[i] === '{') depth += 1;
    if (CSS[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = CSS.slice(open + 1, end);
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
 * table has to be flattened before anything in it can be measured. Resolving
 * per theme is the point: the same declaration lands on a different literal in
 * each one, which is exactly what makes those defaults free.
 */
function resolve(vars: Vars): Vars {
  const out: Vars = {};
  for (const name of Object.keys(vars)) {
    let value = vars[name];
    // Deep enough for any chain this file has a reason to contain, and a hard
    // stop rather than a hang if someone writes a loop.
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

const PAPER = resolve(blockFor(":root,\n[data-theme='paper']"));

/** A theme inherits every value it does not itself declare from Paper. */
function theme(selector: string): Vars {
  // Merged before resolving, so a theme that overrides --c-ink also moves
  // every default that was written as var(--c-ink) -- which is the whole
  // mechanism the scopes rely on.
  return resolve({ ...blockFor(":root,\n[data-theme='paper']"), ...blockFor(selector) });
}

const THEMES: Record<string, Vars> = {
  paper: PAPER,
  ink: theme("[data-theme='ink']"),
  riso: theme("[data-theme='riso']"),
  lightbox: theme("[data-theme='lightbox']"),
  dusk: theme("[data-theme='dusk']"),
};

function luminance(hex: string): number {
  const parts = hex.replace('#', '').match(/../g);
  if (!parts || parts.length < 3) throw new Error(`Not a hex colour: ${hex}`);
  const [r, g, b] = parts.map((part) => {
    const channel = parseInt(part, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
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
for (const hue of ['--c-w-shopping', '--c-w-jobs', '--c-w-todo', '--c-w-vault'] as const) {
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

/** Dark ink on the count badge, which is a light amber in every theme. */
const BADGE_INK = '#14100a';

let failures = 0;
let checked = 0;

for (const [name, vars] of Object.entries(THEMES)) {
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
      const value = ratio(ink, ground);
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
    const value = ratio(BADGE_INK, badgeFill);
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
