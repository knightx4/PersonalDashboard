/**
 * Counters a spec rule can be checked by: a named number measured over the
 * repository that the gate does not let rise.
 *
 * A rule such as "every comment thread is stored in core.conversations" is not
 * true of the app yet, and will not be for some weeks. What can be true from
 * the day it is written is that it gets no less true. So the rule names a
 * counter, the counter measures how far the code is from it (six thread tables
 * today), the value is recorded in scripts/spec-baseline.json, and
 * `npm run check:specs` fails any change that makes it bigger. When a change
 * makes it smaller, the check writes the lower value into the baseline, so the
 * ground gained cannot be given back later.
 *
 * This file is the engine, kept free of the repository's own counters so a
 * test can run it over a fixture. The counters themselves are registered in
 * scripts/spec-counts.ts, and the command is scripts/check-specs.ts. It is the
 * same ratchet scripts/check-ui.ts keeps for the design laws, with one
 * difference: that one asks for `--update` when a count falls, and this one
 * records the fall itself, because a counter has one number rather than one
 * per file and there is nothing to review in lowering it.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** One named counter. Its name is what a spec rule writes after `count`. */
export type SpecCounter = {
  /** Kebab-case, unique: `thread-tables`. */
  name: string;
  /** What one counted item is, in a phrase: "tables that hold a comment thread". */
  counts: string;
  /**
   * Where the rule wants the count to end up. Absent when the count is held
   * where it is and nothing is planned to bring it down.
   */
  target?: number;
  /**
   * The items counted, each one line (a file path, a table name). The count is
   * the length. Returning the items rather than a number is what lets a
   * failure say which ones are there.
   */
  measure: (root: string) => string[];
};

/** `counter name` -> recorded value. Flat, so a diff of it reads as a list. */
export type SpecBaseline = Record<string, number>;

export type CounterResult = {
  name: string;
  counts: string;
  target?: number;
  value: number;
  /** null for a counter the baseline has no entry for yet. */
  baseline: number | null;
  items: string[];
  state: 'held' | 'rose' | 'fell' | 'new';
};

export type CheckResult = {
  results: CounterResult[];
  /** Baseline entries whose counter is no longer registered. */
  retired: string[];
  /** True when any count rose: the check fails. */
  failed: boolean;
  /** The baseline the run leaves behind: falls lowered, new counters recorded, retired ones gone. */
  next: SpecBaseline;
  /** Whether `next` differs from what was read. */
  changed: boolean;
};

export function readBaseline(path: string): SpecBaseline {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8')) as SpecBaseline;
}

export function writeBaseline(path: string, baseline: SpecBaseline): void {
  const ordered = Object.fromEntries(Object.entries(baseline).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(path, `${JSON.stringify(ordered, null, 2)}\n`);
}

/** Measures every counter against the baseline. Writes nothing. */
export function checkCounters(
  root: string,
  counters: readonly SpecCounter[],
  baseline: SpecBaseline,
): CheckResult {
  const names = new Set<string>();
  for (const c of counters) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.name)) throw new Error(`counter name "${c.name}" is not kebab-case`);
    if (names.has(c.name)) throw new Error(`counter "${c.name}" is registered twice`);
    names.add(c.name);
  }

  const next: SpecBaseline = {};
  const results = counters.map((c): CounterResult => {
    const items = [...new Set(c.measure(root))].sort();
    const value = items.length;
    const recorded = Object.hasOwn(baseline, c.name) ? baseline[c.name] : null;
    let state: CounterResult['state'];
    if (recorded === null) state = 'new';
    else if (value > recorded) state = 'rose';
    else if (value < recorded) state = 'fell';
    else state = 'held';
    // A rise keeps the old value: the baseline only ever moves down.
    next[c.name] = state === 'rose' ? (recorded as number) : value;
    return { name: c.name, counts: c.counts, target: c.target, value, baseline: recorded, items, state };
  });

  const retired = Object.keys(baseline).filter((name) => !names.has(name));
  const changed =
    retired.length > 0 || Object.entries(next).some(([name, value]) => baseline[name] !== value);
  return { results, retired, failed: results.some((r) => r.state === 'rose'), next, changed };
}

// -- Helpers for writing counters -------------------------------------------

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'coverage', '.vercel']);

/**
 * Every file under `dirs` (relative to root) whose name ends in one of `exts`,
 * as a root-relative path with forward slashes. A missing directory is empty.
 */
export function listFiles(root: string, dirs: readonly string[], exts: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full);
      } else if (exts.some((x) => e.name.endsWith(x))) {
        out.push(relative(root, full).split(sep).join('/'));
      }
    }
  };
  for (const d of dirs) walk(join(root, d));
  return out.sort();
}

/** The files under `dirs` whose text matches `pattern`. */
export function filesMatching(
  root: string,
  opts: { dirs: readonly string[]; exts: readonly string[]; pattern: RegExp; exclude?: RegExp },
): string[] {
  return listFiles(root, opts.dirs, opts.exts).filter(
    (file) => !opts.exclude?.test(file) && opts.pattern.test(readFileSync(join(root, file), 'utf8')),
  );
}

export type CreatedTable = {
  /** Schema-qualified, lower case: `public.dev_comments`. */
  name: string;
  /** The migration that created it (or last renamed it), root-relative. */
  file: string;
  /** The text of its `create table` statement, for counters that look at columns. */
  definition: string;
};

const IDENT = String.raw`(?:"?[a-z_][a-z0-9_]*"?\.)?"?[a-z_][a-z0-9_]*"?`;

function qualify(name: string, schema: string): string {
  const bare = name.replaceAll('"', '').toLowerCase();
  return bare.includes('.') ? bare : `${schema}.${bare}`;
}

/**
 * The tables the migrations leave standing: every `create table` in the
 * `supabase/migrations*` directories, in file order, less the ones a later
 * `drop table` removes, with `alter table … rename to` followed. An
 * unqualified name is in `public`. Statements are found by pattern rather than
 * parsed, which is right for how these migrations are written and would be
 * wrong for SQL built inside a function body.
 */
export function tablesCreated(root: string): CreatedTable[] {
  const base = join(root, 'supabase');
  let dirs: string[];
  try {
    dirs = readdirSync(base).filter((d) => d.startsWith('migrations')).sort();
  } catch {
    return [];
  }
  const tables = new Map<string, CreatedTable>();
  const statement = new RegExp(
    String.raw`create\s+table\s+(?:if\s+not\s+exists\s+)?(${IDENT})\s*\(` +
      String.raw`|drop\s+table\s+(?:if\s+exists\s+)?(${IDENT}(?:\s*,\s*${IDENT})*)` +
      String.raw`|alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(${IDENT})\s+rename\s+to\s+("?[a-z_][a-z0-9_]*"?)` +
      String.raw`|set\s+(?:local\s+)?search_path\s*(?:=|to)\s*("?[a-z_][a-z0-9_]*"?)`,
    'gi',
  );
  for (const dir of dirs) {
    for (const file of listFiles(root, [`supabase/${dir}`], ['.sql'])) {
      // Comments go first, so a commented-out statement does not count.
      const sql = readFileSync(join(root, file), 'utf8')
        .replace(/--[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');
      let schema = 'public';
      for (const m of sql.matchAll(statement)) {
        if (m[5]) {
          schema = m[5].replaceAll('"', '').toLowerCase();
        } else if (m[1]) {
          const name = qualify(m[1], schema);
          const end = sql.indexOf(';', m.index);
          tables.set(name, { name, file, definition: sql.slice(m.index, end === -1 ? undefined : end) });
        } else if (m[2]) {
          for (const t of m[2].split(',')) tables.delete(qualify(t.trim(), schema));
        } else if (m[3] && m[4]) {
          const from = qualify(m[3], schema);
          const was = tables.get(from);
          const into = from.slice(0, from.indexOf('.'));
          const to = `${into}.${m[4].replaceAll('"', '').toLowerCase()}`;
          tables.delete(from);
          tables.set(to, { name: to, file, definition: was?.definition ?? '' });
        }
      }
    }
  }
  return [...tables.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// -- The command --------------------------------------------------------------

/**
 * What `npm run check:specs` does, given its counters and where its baseline
 * is: measure, report, write the baseline back when a count fell or a counter
 * was added or retired, and return the exit code. 1 when a count rose, and the
 * baseline is then left as it was.
 */
export function runSpecCheck(opts: {
  root: string;
  counters: readonly SpecCounter[];
  baselinePath: string;
  list?: boolean;
  log?: (line: string) => void;
  error?: (line: string) => void;
}): number {
  const log = opts.log ?? console.log;
  const error = opts.error ?? console.error;
  const shown = relative(opts.root, opts.baselinePath).split(sep).join('/');
  const check = checkCounters(opts.root, opts.counters, readBaseline(opts.baselinePath));

  for (const r of check.results) {
    const target = r.target === undefined ? '' : `, target ${r.target}`;
    log(`  ${String(r.value).padStart(4)}  ${r.name} (${r.counts}${target})`);
    if (opts.list) for (const item of r.items) log(`          ${item}`);
  }
  if (check.results.length === 0) log('  No counters registered.');

  const rose = check.results.filter((r) => r.state === 'rose');
  if (rose.length > 0) {
    error('');
    for (const r of rose) {
      error(`✗ ${r.name} rose from ${r.baseline} to ${r.value}: ${r.counts}.`);
      for (const item of r.items) error(`    ${item}`);
    }
    error('');
    error('A spec rule holds this count where it is, so the change has added to what the rule says');
    error('should go. Take out what it added, or bring the count down elsewhere by as much.');
    error('The rule is in the spec that names the counter; the counters are in scripts/spec-counts.ts.');
    return 1;
  }

  if (check.changed) {
    writeBaseline(opts.baselinePath, check.next);
    for (const r of check.results) {
      if (r.state === 'fell') log(`\n✓ ${r.name} fell from ${r.baseline} to ${r.value}; recorded.`);
      if (r.state === 'new') log(`\n✓ ${r.name} is new; recorded at ${r.value}.`);
    }
    for (const name of check.retired) log(`\n✓ ${name} is no longer a counter; removed.`);
    log(`  Commit ${shown} with the change.`);
  } else {
    log(`\n✓ No count rose.`);
  }
  return 0;
}
