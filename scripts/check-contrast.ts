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

const PAPER = blockFor(":root,\n[data-theme='paper']");

/** A theme inherits every value it does not itself declare from Paper. */
function theme(selector: string): Vars {
  return { ...PAPER, ...blockFor(selector) };
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

/** Every ground a given ink can legitimately land on. */
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
