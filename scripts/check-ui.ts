/**
 * The design laws, as far as a machine can hold them.
 *
 *   npm run check:ui                  # check
 *   npm run check:ui -- --list        # check, and print every violation
 *   npm run check:ui -- --update      # re-record the baseline
 *
 * Written after an audit found eighty-six hand-rolled boxes and one bug that
 * had been shipping silently for months, both by grep. That is the argument
 * for this file: everything findable that way should be found by a script that
 * runs on every push, not by whoever happens to look. A review finds a
 * violation once; a gate finds it forever.
 *
 * It only holds the laws that are *mechanical*. "Does this feel like a form"
 * is not in here and cannot be -- that is the residue a person reads. What is
 * in here is the majority by count, which is what clears the ground so the
 * residue is visible.
 *
 * -- The ratchet --
 * The codebase did not pass on the day this was written, and waiting until it
 * did would have meant landing the gate after the cleanup it exists to
 * measure. So violations are counted per file per rule and compared against
 * scripts/ui-baseline.json: a count going *up*, or a violation in a file with
 * no entry, fails. A count going down is reported and asks for --update, which
 * is how the number only ever moves one way. New code is held to zero from its
 * first line, because a new file has no baseline entry.
 *
 * -- The pressure valve --
 * A `ui-ok:` comment on the offending line, or on the line above it,
 * suppresses that line. For something that is right across a whole block --
 * the four brand hexes inside a Google logo, say -- `ui-ok-file: <rule-id>`
 * anywhere in the file suppresses that one rule in that one file. It has to
 * name the rule, so it is an exemption rather than an amnesty: a file excused
 * for its logo is still held to every other law.
 *
 * A rule that cannot be escaped gets worked around by whoever is in a hurry,
 * and a worked-around rule is worse than no rule because it also lies. The
 * reason after the colon is not checked -- it is there so the next reader
 * knows it was a decision rather than an oversight.
 */
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const BASELINE = join(ROOT, 'scripts/ui-baseline.json');
const ROOTS = ['app', 'components'];

/**
 * The primitives are where the app is allowed to write the thing everywhere
 * else must not. `Card` has to say `rounded-card border` somewhere, or there
 * is no Card for anyone to use instead.
 */
const EXEMPT = ['components/ui/'];

// -- The one rule that reads the real CSS -----------------------------------
/**
 * Which `--color-*` are unsafe to read through `var()`.
 *
 * A custom property inherits its *computed* value. The scoped tokens are given
 * their value below :root -- at <body>, at [data-workspace], again at anything
 * painting a sheet -- so `var(--color-accent)` read at :root computes to
 * nothing and every descendant inherits that nothing, whatever scope surrounds
 * it. The utility class resolves at the element and is correct; the var is
 * silently empty. Not a hypothetical: four checkboxes shipped with
 * `accent-[var(--color-accent)]` and no accent colour at all.
 *
 * Derived, not listed. A token is unsafe when its `--c-*` source is never
 * declared at :root or in a theme block, and that is a fact about
 * app/globals.css which this reads rather than remembers -- so a token that
 * gains or loses a root value moves in and out of this set on its own.
 */
function unsafeTokens(): Set<string> {
  const css = readFileSync(join(ROOT, 'app/globals.css'), 'utf8');

  // The names `@theme inline` exposes, and the raw variable each points at.
  const exposed = new Map<string, string>();
  for (const [, name, source] of css.matchAll(/--color-([\w-]+):\s*var\(--(c-[\w-]+)\)/g)) {
    exposed.set(name, source);
  }

  // Every raw variable given a value at :root or under a theme -- everything
  // that has resolved before any scope gets involved.
  const rooted = new Set<string>();
  for (const block of css.matchAll(/(:root|\[data-theme='[\w-]+'\])[^{]*\{([\s\S]*?)\n\}/g)) {
    // Capture without the leading `--`, to match the shape `exposed` holds.
    for (const [, name] of block[2]!.matchAll(/^\s*--(c-[\w-]+):/gm)) rooted.add(name);
  }

  const unsafe = new Set<string>();
  for (const [name, source] of exposed) if (!rooted.has(source)) unsafe.add(name);
  return unsafe;
}

const UNSAFE = unsafeTokens();

// -- The rules --------------------------------------------------------------
type Rule = {
  id: string;
  law: string;
  says: string;
  instead: string;
  /** Every offending span on this line, or nothing. */
  find: (line: string) => string[];
};

/**
 * `border` on its own. `border-t` is a rule drawn between things rather than a
 * frame drawn around one, and law 11 is about frames.
 */
const FULL_BORDER = /\bborder\b(?!-[trblxy]\b)(?!-\d)/;

const RULES: Rule[] = [
  {
    id: 'hand-rolled-box',
    law: '11',
    says: 'a rounded box with a full border, drawn by hand',
    instead: 'Card, CardSection, or Group where the grouping needs no frame at all',
    find: (line) => {
      const out: string[] = [];
      for (const match of line.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        const value = match[1] ?? match[2] ?? '';
        if (/\brounded-/.test(value) && FULL_BORDER.test(value)) out.push(value.slice(0, 64));
      }
      return out;
    },
  },
  {
    id: 'fixed-control-height',
    law: '9',
    says: 'a control height written as a number',
    instead: 'h-(--control-h), so it follows the density dial and the controls beside it',
    find: (line) => [...line.matchAll(/\b(h-(?:9|10|11)|min-h-24)\b/g)].map((m) => m[1]!),
  },
  {
    id: 'scoped-token-in-var',
    law: '-',
    says: 'a scoped token read through var(), which computes to nothing at :root and inherits that nothing',
    instead: 'the utility class, which resolves at the element instead',
    find: (line) => {
      const out: string[] = [];
      for (const match of line.matchAll(/var\(--color-([\w-]+)\)/g)) {
        if (UNSAFE.has(match[1]!)) out.push(match[0]);
      }
      return out;
    },
  },
  {
    id: 'raw-hex',
    law: '4',
    says: 'a colour written as a hex',
    instead: 'a token: four themes cannot follow a literal',
    find: (line) => [...line.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0]),
  },
  {
    id: 'off-scale-text',
    law: '-',
    says: 'a font size outside the named scale',
    instead: 'text-micro | text-small | text-ui | text-body | text-lead | text-title | text-figure',
    find: (line) => [...line.matchAll(/\btext-\[[\d.]+(?:px|rem|em)\]/g)].map((m) => m[0]),
  },
];

// -- The walk ---------------------------------------------------------------
type Hit = { file: string; line: number; rule: Rule; text: string };

function files(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function scan(): Hit[] {
  const hits: Hit[] = [];
  for (const root of ROOTS) {
    for (const path of files(join(ROOT, root))) {
      const file = relative(ROOT, path);
      if (EXEMPT.some((prefix) => file.startsWith(prefix))) continue;
      const source = readFileSync(path, 'utf8');
      const lines = source.split('\n');
      const excused = new Set(
        [...source.matchAll(/ui-ok-file:\s*([\w-]+)/g)].map((match) => match[1]!),
      );
      lines.forEach((line, index) => {
        // Prose, not code. A doc comment explaining why not to write
        // `var(--color-accent)` should not be reported for writing it, and the
        // file that documents these rules is the file most likely to quote
        // them. Continuation lines of a block comment and whole-line `//`
        // comments are the two shapes that carry prose; a real declaration
        // never starts a line with `*`.
        const trimmed = line.trimStart();
        if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return;

        // The valve: on this line, or on the one above it.
        if (line.includes('ui-ok:') || (index > 0 && lines[index - 1]!.includes('ui-ok:'))) return;
        for (const rule of RULES) {
          if (excused.has(rule.id)) continue;
          for (const text of rule.find(line)) hits.push({ file, line: index + 1, rule, text });
        }
      });
    }
  }
  return hits;
}

/** `rule file` -> count. Flat, so a diff of the baseline reads as a list. */
function tally(hits: Hit[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const hit of hits) {
    const key = `${hit.rule.id} ${hit.file}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

// -- The report -------------------------------------------------------------
const hits = scan();
const counts = tally(hits);

if (process.argv.includes('--update')) {
  const ordered = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(BASELINE, `${JSON.stringify(ordered, null, 2)}\n`);
  console.log(`Recorded ${hits.length} violations across ${Object.keys(ordered).length} file/rule pairs.`);
  process.exit(0);
}

let baseline: Record<string, number> = {};
try {
  baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, number>;
} catch {
  console.error('No baseline yet. Record one with: npm run check:ui -- --update');
  process.exit(1);
}

if (process.argv.includes('--list')) {
  for (const hit of hits) console.log(`${hit.file}:${hit.line}  ${hit.rule.id}  ${hit.text}`);
  console.log('');
}

const regressions = hits.filter((hit) => {
  const key = `${hit.rule.id} ${hit.file}`;
  return (counts[key] ?? 0) > (baseline[key] ?? 0);
});

if (regressions.length > 0) {
  console.error(`\n✗ ${regressions.length} new UI violation(s).\n`);
  const explained = new Set<string>();
  for (const hit of regressions) {
    console.error(`  ${hit.file}:${hit.line}`);
    console.error(`    ${hit.text}`);
    if (!explained.has(hit.rule.id)) {
      explained.add(hit.rule.id);
      console.error(`    law ${hit.rule.law}: ${hit.rule.says}`);
      console.error(`    use ${hit.rule.instead}`);
    }
    console.error('');
  }
  console.error('If it is genuinely right, say so on the line: /* ui-ok: why */');
  console.error('The laws are at /dev/ui, and in app/dev/ui/laws.ts.\n');
  process.exit(1);
}

// Per-rule standings, so the number that is meant to fall is visible.
const byRule = new Map<string, number>();
for (const hit of hits) byRule.set(hit.rule.id, (byRule.get(hit.rule.id) ?? 0) + 1);
for (const rule of RULES) {
  const n = byRule.get(rule.id) ?? 0;
  console.log(`  ${n === 0 ? '  ·' : String(n).padStart(3)}  ${rule.id}`);
}

const known = Object.values(baseline).reduce((sum, n) => sum + n, 0);
const fixed = known - hits.length;
if (fixed > 0) {
  console.log(`\n✓ No new violations, and ${fixed} fewer than the baseline.`);
  console.log('  Lock the gain in: npm run check:ui -- --update\n');
} else {
  console.log(`\n✓ No new UI violations. ${hits.length} known, none added.\n`);
}
