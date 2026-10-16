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
import { dirname, join } from 'node:path';
import { actionGaps, unconvertedPaidButtons } from '../lib/agent-actions/catalogue';
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

/**
 * Learn's tabs are written in the shared list since plan #2208.2, not in its
 * layout: the `learn: [` block of lib/shell/tabs.ts, up to the line that
 * closes it.
 */
const TAB_LIST = 'lib/shell/tabs.ts';

function learnTabs(root: string): string {
  const text = read(root, TAB_LIST, 'learn-nav-tabs');
  const start = text.indexOf('\n  learn: [');
  const end = text.indexOf('\n  ],', start);
  if (start < 0 || end < 0) throw new Error(`learn-nav-tabs cannot find Learn's tabs in ${TAB_LIST}; update the counter`);
  return text.slice(start, end);
}

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

// -- docs/ONE-INTERFACE-SPEC.md ---------------------------------------------

/**
 * Rule R14: a radius class is one of the tokens the themes move
 * (`rounded-pane`, `rounded-card`, `rounded-control`, `rounded-pill`) or
 * `rounded-full`. One item per other radius class in a string under app/ or
 * components/, as `file:line: the class`: the fixed sizes (`rounded`,
 * `rounded-lg`, `rounded-[7px]`), with or without a side (`rounded-t-md`) or
 * a variant (`sm:rounded-xl`). Aurora's rounder and Poster's square corners
 * reach only the tokens, so a fixed size is a corner the theme skips.
 *
 * `rounded-none` is allowed: zero is zero in every theme, and it is how a
 * component's own corner is taken off where an edge meets the page.
 *
 * Read from string literals with the comments blanked, and only those that
 * read as a class list: prose about a class ("rounded-lg is a fixed 8px.")
 * has a comma, a colon or a full stop followed by a space, or ends a
 * sentence. app/preview/overhaul/now.tsx and entries.tsx are not read: they
 * draw and describe the markup from before the component overhaul, on
 * purpose, beside what replaced it.
 */
const RADIUS_CLASS =
  /(?<![\w-])((?:[\w-]+:)*rounded(?:-(?:t|b|l|r|s|e|tl|tr|bl|br|ss|se|es|ee))?(?:-([\w.]+|\[[^\]\s]+\]))?)(?![\w-])/g;
const ON_TOKEN = new Set(['pane', 'card', 'control', 'pill', 'full', 'none']);
const STRING_LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
const PROSE = /[,.;:?!]\s|[.?!]['"`]?$/;
const RADIUS_RECORDS = new Set(['app/preview/overhaul/now.tsx', 'app/preview/overhaul/entries.tsx']);

function offTokenRadius(root: string): string[] {
  const out: string[] = [];
  for (const file of listFiles(root, ['app', 'components'], ['.ts', '.tsx'])) {
    if (/\.test\.tsx?$/.test(file) || RADIUS_RECORDS.has(file)) continue;
    const code = withoutComments(readFileSync(join(root, file), 'utf8'));
    for (const literal of code.matchAll(STRING_LITERAL)) {
      const body = literal[0].slice(1, -1);
      if (PROSE.test(body)) continue;
      for (const m of body.matchAll(RADIUS_CLASS)) {
        if (m[2] !== undefined && ON_TOKEN.has(m[2])) continue;
        out.push(`${file}:${lineAt(code, literal.index + 1 + m.index)}: ${m[1]}`);
      }
    }
  }
  return out;
}

/**
 * Rule R15: Lucide icons are drawn at one stroke weight, ICON_STROKE (1.75,
 * app/dev/ui/measurements.ts). One item per Lucide element under app/ or
 * components/ drawn at any other weight, as `file:line: <Name strokeWidth>`.
 * An element with no strokeWidth counts too: Lucide's own default is 2.
 *
 * A Lucide element is a tag named by an import from `lucide-react` (an alias
 * included), or, in a file that imports from it, a tag named `Icon` or
 * `…Icon` that the file does not define itself: the `Icon` a row is handed as
 * a `LucideIcon`. The one weight allowed besides 1.75 is the phone dock's
 * current tab, drawn at 2 on purpose so the tab you are on reads heavier.
 * The overhaul records are not read, as for R14.
 */
const LUCIDE_IMPORT = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]lucide-react['"]/g;
const JSX_OPEN = /<([A-Z][\w.]*)(\s[^<>]*?)?\/?>/g;
const STROKE_PROP = /\bstrokeWidth=(?:\{([^}]*)\}|"([^"]*)")/;
const ON_STROKE = /^(?:1\.75|(?:\w+\.)?ICON_STROKE)$/;
const DOCK_CURRENT = { file: 'components/shell/app-shell.tsx', value: 'on ? 2 : 1.75' };

function iconStrokeOff(root: string): string[] {
  const out: string[] = [];
  for (const file of listFiles(root, ['app', 'components'], ['.tsx'])) {
    if (/\.test\.tsx$/.test(file) || RADIUS_RECORDS.has(file)) continue;
    const code = withoutComments(readFileSync(join(root, file), 'utf8'));
    if (!code.includes('lucide-react')) continue;
    const names = new Set<string>();
    for (const m of code.matchAll(LUCIDE_IMPORT)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim() ?? '';
        if (/^[A-Z]/.test(name) && !/^Lucide(?:Icon|Props)$/.test(name)) names.add(name);
      }
    }
    for (const m of code.matchAll(JSX_OPEN)) {
      const name = m[1];
      const handed =
        /(?:^|\.)\w*Icon$/.test(name) &&
        !new RegExp(`\\b(?:function|const)\\s+${name.replace('.', '\\.')}\\b`).test(code);
      if (!names.has(name) && !handed) continue;
      const prop = (m[2] ?? '').match(STROKE_PROP);
      const value = prop ? (prop[1] ?? prop[2]).trim() : null;
      if (value !== null && ON_STROKE.test(value)) continue;
      if (file === DOCK_CURRENT.file && value === DOCK_CURRENT.value) continue;
      out.push(`${file}:${lineAt(code, m.index)}: <${name} strokeWidth=${value ?? '(Lucide default 2)'}>`);
    }
  }
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

// -- docs/ONE-INTERFACE-SPEC.md -------------------------------------------------

/**
 * Part 2: every page for one row says where it sits, drawn from the
 * catalogue by refPath (lib/core/refs.ts, plan #1931). A page for one row is
 * a `page.tsx` whose route has a dynamic segment (`[id]`, `[...path]`). It
 * draws a path when it, or a file it imports from app/ or components/ (two
 * imports deep, which reaches a page's view and that view's header), passes
 * `crumbs` or a PageHeader or TabbedDetail `subject`, or draws a Breadcrumb itself. Pages
 * that only send the visitor on are not counted, nor is /open/[ref], which is
 * one of those that reads a row first, nor the two pages for someone with no
 * account (a case page sent to an employer, a shared shelf), which sit in no
 * workspace and have nowhere to lead back to.
 */
const DRAWS_PATH =
  /\bcrumbs=\{|<Breadcrumb\b|<(?:PageHeader|TabbedDetail)\b[\s\S]{0,2000}?\bsubject=\{/;
const LOCAL_IMPORT = /\bfrom\s+'((?:\.{1,2}\/|@\/(?:app|components)\/)[^']+)'/g;
const NOT_ROW_PAGES = new Set(['app/open/[ref]/page.tsx', 'app/jobs/p/[slug]/page.tsx', 'app/s/[token]/page.tsx']);
/**
 * The shared shell and patterns pass a path through (PageHeader draws the
 * Breadcrumb it is given), so importing them is not drawing one.
 */
const PASSES_PATH_THROUGH = /^components\/(?:shell|patterns)\//;

function importedFiles(root: string, file: string, text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(LOCAL_IMPORT)) {
    const spec = m[1];
    const base = spec.startsWith('@/') ? spec.slice(2) : join(dirname(file), spec);
    const found = ['.tsx', '.ts', '/index.tsx', '/index.ts']
      .map((ext) => `${base}${ext}`)
      .find((candidate) => existsSync(join(root, candidate)));
    if (found && !PASSES_PATH_THROUGH.test(found)) out.push(found);
  }
  return out;
}

function drawsPath(root: string, file: string, depth: number, seen: Set<string>): boolean {
  if (seen.has(file)) return false;
  seen.add(file);
  const text = withoutComments(readFileSync(join(root, file), 'utf8'));
  if (DRAWS_PATH.test(text)) return true;
  if (depth === 0) return false;
  return importedFiles(root, file, text).some((next) => drawsPath(root, next, depth - 1, seen));
}

function rowPagesWithoutPath(root: string): string[] {
  return listFiles(root, ['app'], ['.tsx'])
    .filter((file) => /\/page\.tsx$/.test(file) && /\/\[/.test(file) && !NOT_ROW_PAGES.has(file))
    .filter((file) => routeOfFile(file) !== null)
    .filter((file) => !isRedirectOnly(readFileSync(join(root, file), 'utf8')))
    .filter((file) => !drawsPath(root, file, 2, new Set()))
    .sort();
}

/**
 * Part 2 (plan #1931.3): a row page has one back link, drawn by PageHeader
 * through components/shell/back-link.tsx, which keeps the list's filters and
 * its scroll. A hand-rolled one is a link whose first child is a left arrow or
 * chevron followed by its label, or a button that calls the router's or the
 * history's back(). A chevron alone in a link, such as the day before on a
 * calendar or a review, is a step through siblings and is not counted; nor is
 * the gallery, which draws pages that are not the app's.
 */
const HAND_BACK_LINK =
  /<(?:Link|a)\b[^>]*\bhref=[^>]*>\s*<(?:ArrowLeft|ChevronLeft)\b[^>]*\/>\s*(?![<\s])/g;
const HISTORY_BACK = /\b(?:router|history)\.back\(\)/g;
const BACK_LINK_HOME = new Set(['components/shell/back-link.tsx']);

function handRolledBackLinks(root: string): string[] {
  return listFiles(root, ['app', 'components'], ['.tsx'])
    .filter((file) => !BACK_LINK_HOME.has(file) && !/^app\/preview\/|\.test\.tsx$/.test(file))
    .flatMap((file) => {
      const text = withoutComments(readFileSync(join(root, file), 'utf8'));
      return [...text.matchAll(HAND_BACK_LINK), ...text.matchAll(HISTORY_BACK)].map(
        (m) => `${file}:${lineAt(text, m.index ?? 0)}`,
      );
    })
    .sort();
}

/**
 * Part 3, R8 (plan #1950.3.4): a page whose only job is a form. Such a page
 * takes the address of the thing it adds, so every `page.tsx` whose route has
 * a `new` or `add` segment is counted (what were `/you/places/new` and
 * `/shopping/inventory/add/books`). A page there that only sends the visitor
 * on draws no form and is not counted. An add belongs in capture, aimed at
 * the kind from the list's Add button.
 */
function formOnlyPages(root: string): string[] {
  return listFiles(root, ['app'], ['.tsx', '.ts', '.jsx', '.js'])
    .filter((file) => /\/page\.[jt]sx?$/.test(file))
    .filter((file) => {
      const route = routeOfFile(file);
      return route !== null && route.split('/').some((segment) => segment === 'new' || segment === 'add');
    })
    .filter((file) => !isRedirectOnly(readFileSync(join(root, file), 'utf8')))
    .sort();
}

/**
 * docs/ONE-INTERFACE-SPEC.md, R6 (plan #1957.4): a date or time becomes words
 * only in lib/core/when.ts. A file that calls one of the four platform
 * formatters is counted, except when.ts and the tests.
 */
const DATE_FORMATTER = /\b(?:Intl\.DateTimeFormat|toLocaleDateString|toLocaleString|toLocaleTimeString)\b/;
const WHEN_HOME = 'lib/core/when.ts';

/**
 * docs/ONE-INTERFACE-SPEC.md, R12 (plan #1964.1): a control that calls a
 * model names Dash, and "AI" appears on no control. Counts each button or
 * link under app/ and components/ whose label, the text between its tags,
 * holds the word AI. The gallery's fixtures are not controls and are left out.
 */
const CONTROL_ELEMENT = /<(Button|button|Link|a|DashAction|RowAction)\b[^>]*>([\s\S]*?)<\/\1>/g;
const AI_WORD = /(?<![\w-])AI(?![\w-])/;

function aiOnControls(root: string): string[] {
  return listFiles(root, ['app', 'components'], ['.tsx'])
    .filter((file) => !/^app\/preview\/|\.test\.tsx$/.test(file))
    .flatMap((file) => {
      const text = withoutComments(readFileSync(join(root, file), 'utf8'));
      return [...text.matchAll(CONTROL_ELEMENT)]
        .filter((m) => AI_WORD.test(m[2].replace(/\{\/\*[\s\S]*?\*\/\}/g, '')))
        .map((m) => `${file}:${lineAt(text, m.index ?? 0)}`);
    })
    .sort();
}

/**
 * Plan #1964.1: every press that spends a model run is a DashAction, which
 * draws its cost hint itself. A PaidHint or CostHint written anywhere else
 * under app/ and components/ is a paid button not yet moved onto it. The
 * primitives that define them and the gallery are left out.
 *
 * A hint that is not on a Dash press is passed by a `dash-action-ok:`
 * comment on its line or the line above, saying why: a composer whose send
 * is an arrow beside the text, or a price that is not a model run, such as
 * posting to X.
 */
const HINT_ELEMENT = /<(?:PaidHint|CostHint)\b/g;
const HINT_HOMES = new Set([
  'components/ui/paid-hint.tsx',
  'components/ui/cost-hint.tsx',
  'components/ui/dash-action.tsx',
  // The one thread (plan #1964.3) prices a reply beside the arrow that sends
  // it and the button that opens its box, the way DashAction prices a press,
  // so every conversation takes its hint from here.
  'components/thread/thread.tsx',
]);

function paidHintsOutsideDashAction(root: string): string[] {
  return listFiles(root, ['app', 'components'], ['.tsx'])
    .filter((file) => !HINT_HOMES.has(file) && !/^app\/preview\/|\.test\.tsx$/.test(file))
    .flatMap((file) => {
      const raw = readFileSync(join(root, file), 'utf8');
      const lines = raw.split('\n');
      const text = withoutComments(raw);
      return [...text.matchAll(HINT_ELEMENT)]
        .map((m) => lineAt(text, m.index ?? 0))
        .filter((line) => !/dash-action-ok:\s*\S/.test(`${lines[line - 2] ?? ''}\n${lines[line - 1]}`))
        .map((line) => `${file}:${line}`);
    })
    .sort();
}

/**
 * docs/ONE-INTERFACE-SPEC.md, "One thread" (plan #1964.3): one component
 * draws every conversation. A file draws turns of its own when it names the
 * person's turns "You" and draws both the person's glyph (CircleUser) and
 * Dash's mark beside them. The gallery is left out; the target is the one
 * thread, components/thread/thread.tsx.
 */
const PERSON_GLYPH = /\bCircleUser\b/;
const YOU_NAME = /['"`]You['"`]/;

function threadComponents(root: string): string[] {
  return listFiles(root, ['app', 'components'], ['.tsx'])
    .filter((file) => !/^app\/preview\/|\.test\.tsx$/.test(file))
    .filter((file) => {
      const text = withoutComments(readFileSync(join(root, file), 'utf8'));
      return PERSON_GLYPH.test(text) && /\bDashMark\b/.test(text) && YOU_NAME.test(text);
    })
    .sort();
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
    name: 'date-formatting-files',
    counts: 'files other than lib/core/when.ts that turn a date or a time into words with the platform',
    target: 0,
    measure: (root) =>
      filesMatching(root, {
        dirs: ['app', 'components', 'lib'],
        exts: ['.ts', '.tsx'],
        pattern: DATE_FORMATTER,
        exclude: /\.test\.tsx?$/,
      }).filter((file) => file !== WHEN_HOME),
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
      [...learnTabs(root).matchAll(/\bhref:\s*'([^']+)'/g)].map((m) => m[1]),
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
    name: 'off-token-radius',
    counts: 'radius classes under app/ and components/ that the themes do not move',
    target: 0,
    measure: offTokenRadius,
  },
  {
    name: 'icon-stroke-off',
    counts: 'Lucide icons under app/ and components/ drawn at a stroke other than 1.75',
    target: 0,
    measure: iconStrokeOff,
  },
  {
    name: 'routes-without-surface',
    counts: 'pages under app/ with no surface in the gallery',
    target: 0,
    measure: routesWithoutSurface,
  },
  {
    // docs/ONE-INTERFACE-SPEC.md, R9 (plan #1927.1): every layout and page
    // gets its shell from shellFor in lib/shell/shell-for.tsx, the one file
    // left. The gallery draws the shell from fixtures and is not counted.
    name: 'shell-mounts',
    counts: 'files outside the gallery that render <AppShell',
    target: 1,
    measure: (root) =>
      filesMatching(root, {
        dirs: ['app', 'components', 'lib'],
        exts: ['.tsx'],
        pattern: /<AppShell\b/,
        exclude: /^app\/preview\/|\.test\.tsx$/,
      }),
  },
  {
    name: 'row-pages-without-path',
    counts: 'pages for one row that draw no path to it',
    target: 0,
    measure: rowPagesWithoutPath,
  },
  {
    name: 'form-only-pages',
    counts: 'pages under app/ at a new or add address, whose only job is a form',
    target: 0,
    measure: formOnlyPages,
  },
  {
    name: 'hand-rolled-back-links',
    counts: 'back links a page draws itself rather than through PageHeader',
    target: 0,
    measure: handRolledBackLinks,
  },
  {
    // Plan #1895: the actions a page lets the person do that an agent should
    // be able to do and has no Dash tool for. Read from the catalogue the
    // modules declare (lib/agent-actions), which its own test holds to the
    // files under app/, so it is measured from the code rather than `root`.
    name: 'agent-action-gaps',
    counts: 'server actions an agent should be able to do and has no tool for',
    target: 0,
    measure: () => actionGaps(),
  },
  {
    // Plan #2228.6: the paid buttons Dash cannot yet press. Plan #2228 gives
    // each one a paid tool or a stated reason; this counts the ones with
    // neither, and a new paid button must start with one of the two.
    name: 'unconverted-paid-buttons',
    counts: "paid buttons catalogued as none('spends') with no reason and no tool",
    target: 0,
    measure: () => unconvertedPaidButtons(),
  },
  {
    name: 'ai-on-controls',
    counts: 'buttons and links under app/ and components/ whose label says AI',
    target: 0,
    measure: aiOnControls,
  },
  {
    name: 'thread-components',
    counts: 'components under app/ and components/ that draw the turns of a conversation',
    target: 1,
    measure: threadComponents,
  },
  {
    name: 'paid-hints-outside-dash-action',
    counts: 'cost hints drawn beside a button rather than by DashAction',
    target: 0,
    measure: paidHintsOutsideDashAction,
  },
];
