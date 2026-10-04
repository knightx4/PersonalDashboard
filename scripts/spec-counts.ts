/**
 * The counters spec rules are checked by. A rule in a spec's `## Rules`
 * section names one as `Checked by: count \`<name>\`, baseline N, target M.`
 * (docs/SPEC-LAYER-SPEC.md, Part 1).
 *
 * Each counter returns the items it counts, measured over the repository at
 * `root`; lib/specs/counts.ts has the helpers (`filesMatching`,
 * `tablesCreated`, `listFiles`) and the ratchet. The recorded values are in
 * scripts/spec-baseline.json, and `npm run check:specs` fails when one rises.
 *
 * To add a counter: add it here, run `npm run check:specs` once to record its
 * value, and commit the baseline with it. To retire one, take it out and run
 * the check again; its baseline entry goes with it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { routeOfFile, surfacesForRoute } from '../lib/preview/routes';
import { filesMatching, listFiles, tablesCreated, type SpecCounter } from '../lib/specs/counts';

/** A file's text, or an error naming the counter that needed it. */
function read(root: string, file: string, counter: string): string {
  const path = join(root, file);
  if (!existsSync(path)) throw new Error(`${counter} reads ${file}, which is not there; update the counter`);
  return readFileSync(path, 'utf8');
}

// -- docs/CORE-AND-DASH-SPEC.md ----------------------------------------------

/**
 * A thread table is one whose rows are turns between the person and Dash (or
 * Maya), told apart by an author or role column checked to one of each:
 * `author in ('me', 'claude')`, `role in ('user', 'assistant')`,
 * `role in ('person', 'maya')`. For core.conversations the turns table is the
 * one counted, so the rule's target of one is core.conversation_turns.
 */
const THREAD_AUTHOR =
  /\b(?:author|role)\b[^;]*?\bin\s*\(\s*'(?:me|user|person)'\s*,\s*'(?:claude|dash|assistant|maya)'\s*\)/i;

/**
 * Marks its rows by author the same way and is not a thread: it is the recall
 * index, which copies turns out of the threads to search them.
 */
const NOT_THREADS = new Set(['core.memory_chunks']);

/**
 * A table whose thread was copied into core.conversations and which takes no
 * more turns (plan #1470): a trigger before insert or update runs
 * core.refuse_thread_writes. It still holds its old rows until the person says
 * it can go, but no thread lives there any more.
 */
const READ_ONLY_TRIGGER =
  /create\s+(?:or\s+replace\s+)?trigger\s+\w+\s+before\s+insert\s+or\s+update\s+on\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)[^;]*?execute\s+(?:function|procedure)\s+core\.refuse_thread_writes\s*\(\s*\)/gi;

function readOnlyThreadTables(root: string): Set<string> {
  const tables = new Set<string>();
  const dirs = [
    'supabase/migrations',
    'supabase/migrations-goals',
    'supabase/migrations-job-search',
    // Maya's threads, read-only since plan #1479.
    'supabase/migrations-vault',
  ];
  for (const file of listFiles(root, dirs, ['.sql'])) {
    const sql = readFileSync(join(root, file), 'utf8').replace(/--[^\n]*/g, '');
    for (const m of sql.matchAll(READ_ONLY_TRIGGER)) tables.add(m[1].toLowerCase());
  }
  return tables;
}

/**
 * A link table with a column per target says which row it points at with one
 * nullable foreign key per kind of target and a check that exactly one is set:
 * `check (num_nonnulls(application_id, role_id, company_id, ...) = 1)`. Three
 * or more `_id` columns, so a choice between two shapes of value is not one.
 */
function pointsByColumnPerTarget(sql: string): boolean {
  for (const m of sql.matchAll(/check\s*\(\s*num_nonnulls\s*\(([^)]*)\)\s*=\s*1\s*\)/gi)) {
    const ids = m[1].split(',').filter((c) => /_id\s*$/i.test(c.trim()));
    if (ids.length >= 3) return true;
  }
  return false;
}

/**
 * The spend operations under which a model answers what the person typed to
 * Dash or Maya. Every model call records one (lib/core/spend/operations.ts,
 * lib/learn/spend.ts). The replies are named `ask-`, `reply-` or `discuss-`;
 * capture's `file-capture` is the one path not named for a reply.
 */
const CONVERSATIONAL_OPERATION = /^\s*'((?:ask|reply|discuss)-[a-z0-9-]+|file-capture)',/gm;
const SPEND_LISTS = ['lib/core/spend/operations.ts', 'lib/learn/spend.ts'];

const MODEL_ID = /['"`]claude-(?:opus|sonnet|haiku)-[0-9][a-z0-9.-]*['"`]/;

// -- docs/CUT-BACK-SPEC.md -----------------------------------------------------

const LEARN_LAYOUT = 'app/learn/layout.tsx';

// -- docs/UI-QUALITY-SPEC.md ---------------------------------------------------

/**
 * Rule R7: animation timings and easings come from the motion tokens
 * (lib/motion.ts and the `--motion-*` and `--ease-*` properties in
 * app/globals.css). One item per duration or easing written out by hand,
 * as `file:line: the value`.
 *
 * In CSS, it reads the animation and transition declarations (and Tailwind's
 * `--animate-*`) for a time other than zero and for a curve: `cubic-bezier()`,
 * `linear()` with points, or an `ease` keyword. `linear`, `steps()` and
 * calc() over the tokens are fine. The 0.01ms the reduced-motion block uses
 * stands for zero. In code, it reads Tailwind classes (`duration-150`,
 * `delay-[…]`, `ease-out`), a curve in a string, a number in an inline
 * animation or transition style, and the duration and easing given to a Web
 * Animations `animate()` call. lib/motion.ts, where the values live, is not
 * read, and nor are comments or tests.
 */
const MOTION_PROPERTY =
  /(?:^|[;{\s])((?:animation|transition)(?:-duration|-delay|-timing-function)?|--animate-[\w-]+)\s*:\s*([^;{}]*)/g;
const CSS_TIME = /(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g;
const CSS_CURVE = /cubic-bezier\(|(?<![\w-])linear\(|(?<![\w-])ease(?:-in-out|-in|-out)?(?![\w-])/;
const TW_TIMING = /(?<![\w-])(?:(?:duration|delay)-(?:\d+|\[[^\]]+\])|ease-(?:in-out|in|out|linear|\[[^\]]+\]))(?![\w-])/g;
const CODE_CURVE = /['"`][^'"`]*(?:cubic-bezier\(|(?<![\w-])linear\()/;
const STYLE_TIMING = /\b(?:animation|transition)(?:Delay|Duration)?\s*:\s*([^,}\n]*)/g;
const ANIMATE_OPTION = /\b(?:duration\s*:\s*\d|easing\s*:\s*['"`])/;

/** The text with comments blanked, keeping every line where it was. */
function withoutComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

function rawMotionInCss(file: string, text: string): string[] {
  const css = withoutComments(text);
  const out: string[] = [];
  for (const m of css.matchAll(MOTION_PROPERTY)) {
    const value = m[2];
    const line = lineAt(css, m.index + m[0].indexOf(m[1]));
    const times = [...value.matchAll(CSS_TIME)].filter((t) => Number(t[1]) !== 0 && t[0] !== '0.01ms');
    if (times.length > 0 || CSS_CURVE.test(value)) out.push(`${file}:${line}: ${m[1]}: ${value.trim().replace(/\s+/g, ' ')}`);
  }
  return out;
}

function rawMotionInCode(file: string, text: string): string[] {
  const code = withoutComments(text);
  const out: string[] = [];
  const animates = code.includes('.animate(');
  code.split('\n').forEach((line, i) => {
    const at = `${file}:${i + 1}`;
    for (const m of line.matchAll(TW_TIMING)) out.push(`${at}: ${m[0]}`);
    const curve = CODE_CURVE.test(line);
    if (curve) out.push(`${at}: ${line.trim()}`);
    for (const m of line.matchAll(STYLE_TIMING)) {
      if (/(?<![\w.])\d+(?:\.\d+)?(?![\w.])/.test(m[1].replace(/\b0(?:ms|s)?\b/g, ''))) out.push(`${at}: ${m[0].trim()}`);
    }
    if (animates && !curve && ANIMATE_OPTION.test(line)) out.push(`${at}: ${line.trim()}`);
  });
  return out;
}

// -- docs/UI-QUALITY-SPEC.md ------------------------------------------------

/** A page that returns nothing and calls `redirect`: a moved address, not a screen. */
function isRedirectOnly(text: string): boolean {
  const code = withoutComments(text);
  return /\b(?:permanentRedirect|redirect)\(/.test(code) && !/\breturn\b/.test(code);
}

/**
 * The pages under `app/` that no gallery surface stands for: every `page.tsx`
 * whose route (route groups and slots taken out, as lib/preview/routes.ts
 * reads them) has no entry in `SURFACE_ROUTES`. API routes and the gallery
 * itself are not pages a person reads, and `routeOfFile` leaves them out.
 * Neither is a page that only sends the visitor on (`app/dev/page.tsx`
 * redirecting to /dev/raised): it draws nothing to picture.
 */
function routesWithoutSurface(root: string): string[] {
  const routes = new Set<string>();
  for (const file of listFiles(root, ['app'], ['.tsx', '.ts', '.jsx', '.js'])) {
    if (!/\/page\.[jt]sx?$/.test(file)) continue;
    if (isRedirectOnly(readFileSync(join(root, file), 'utf8'))) continue;
    const route = routeOfFile(file);
    if (route !== null && surfacesForRoute(route).length === 0) routes.add(route);
  }
  return [...routes].sort();
}

export const SPEC_COUNTERS: readonly SpecCounter[] = [
  {
    name: 'thread-tables',
    counts: 'tables holding turns between the person and Dash',
    target: 1,
    measure: (root) => {
      const readOnly = readOnlyThreadTables(root);
      return tablesCreated(root)
        .filter((t) => !NOT_THREADS.has(t.name) && !readOnly.has(t.name))
        .filter((t) => [t.definition, ...t.alterations].some((sql) => THREAD_AUTHOR.test(sql)))
        .map((t) => t.name);
    },
  },
  {
    name: 'conversational-model-paths',
    counts: 'spend operations for a model answering what the person typed',
    target: 1,
    measure: (root) =>
      SPEND_LISTS.flatMap((file) =>
        [...read(root, file, 'conversational-model-paths').matchAll(CONVERSATIONAL_OPERATION)].map(
          (m) => `${m[1]} (${file})`,
        ),
      ),
  },
  {
    name: 'model-id-files',
    counts: 'files outside the tests holding a model id',
    target: 1,
    measure: (root) =>
      filesMatching(root, {
        dirs: ['app', 'components', 'inngest', 'lib', 'scripts'],
        exts: ['.ts', '.tsx', '.js', '.mjs'],
        pattern: MODEL_ID,
        exclude: /\.test\.tsx?$/,
      }),
  },
  {
    name: 'link-tables-per-target-column',
    counts: 'tables pointing at a row through one column per kind of target',
    target: 0,
    measure: (root) =>
      tablesCreated(root)
        .filter((t) => [t.definition, ...t.alterations].some(pointsByColumnPerTarget))
        .map((t) => t.name),
  },
  {
    name: 'learn-nav-tabs',
    counts: "tabs in Learn's nav",
    measure: (root) =>
      [...read(root, LEARN_LAYOUT, 'learn-nav-tabs').matchAll(/\bhref:\s*'([^']+)'/g)].map((m) => m[1]),
  },
  {
    name: 'raw-motion-values',
    counts: 'animation durations and easings written out by hand rather than taken from the motion tokens',
    target: 0,
    measure: (root) => [
      ...listFiles(root, ['app', 'components'], ['.css']).flatMap((file) =>
        rawMotionInCss(file, readFileSync(join(root, file), 'utf8')),
      ),
      ...listFiles(root, ['app', 'components', 'lib'], ['.ts', '.tsx'])
        .filter((file) => !/\.test\.tsx?$/.test(file) && file !== 'lib/motion.ts')
        .flatMap((file) => rawMotionInCode(file, readFileSync(join(root, file), 'utf8'))),
    ],
  },
  {
    name: 'routes-without-surface',
    counts: 'pages under app/ with no surface in the gallery',
    target: 0,
    measure: routesWithoutSurface,
  },
];
