/**
 * The plan: read and update what is being built.
 *
 * This is how a session works the plan rather than the notes queue -- the
 * same rows /dev/plan shows, read and written from a terminal, so that what
 * a person decided on the page is what a session picks up, and what the
 * session did is on the page the moment it is done.
 *
 *   npx tsx scripts/plan.ts list [--all] [--module <id>] [--claude]
 *   npx tsx scripts/plan.ts next [--claude] [--limit <n>] [--module <id>]
 *   npx tsx scripts/plan.ts show <n>
 *   npx tsx scripts/plan.ts add "<title>" [--parent <n>] [--module <id>]
 *                                [--priority 1|2|3] [--size s|m|l]
 *                                [--detail "…"] [--done-when "…"]
 *                                [--proposed] [--idea <id prefix>]
 *                                [--kind decision|setup] [--from <n>]
 *                                # under an approved feature a step is ready
 *                                # to build, stamped with the session that
 *                                # added it; --proposed holds it for the person
 *   npx tsx scripts/plan.ts needs "<what to set>" --for <n> [--detail "…"]
 *                                # something only the person can supply: one
 *                                # setup job of theirs, under the feature that
 *                                # ran into it, and #<n> waits on it
 *   npx tsx scripts/plan.ts ideas                       # ideas not yet shaped into the plan
 *   npx tsx scripts/plan.ts idea "<body>" [--module <id>] [--from <n>]
 *                                # file one follow-on, marked as your suggestion
 *   npx tsx scripts/plan.ts idea --file <path.md>       # file every "## " section of a file
 *                                # either way, one close to an idea already
 *                                # filed is refused and names what it matched,
 *                                # and at most two an hour are written
 *   npx tsx scripts/plan.ts raise "<title>" --ask "…" --consequence "<action>: <what>"
 *                                [--detail "…"] [--module <id>]
 *                                [--from <n>] [--source "…"]   # ask the person something
 *   npx tsx scripts/plan.ts raises                      # open raises, and answers not replied to
 *   npx tsx scripts/plan.ts check-back "<title>" --after 2h|90m|1d | --at <ISO time>
 *                                [--detail "what to check and what to do"]
 *                                [--from <n>] [--source "…"] [--no-wake]
 *                                # come back to something after some time: the
 *                                # next session to run after it falls due picks
 *                                # it up, and the tick wakes one if none has
 *   npx tsx scripts/plan.ts check-backs [--all]         # due first, then coming up
 *   npx tsx scripts/plan.ts checked <id> --note "what it found" [--drop]
 *   npx tsx scripts/plan.ts approve <n>                 # a person's move, never a session's
 *   npx tsx scripts/plan.ts start <n>
 *   npx tsx scripts/plan.ts done <n> --note "what shipped" [--commit <sha>]
 *                                # refused unless GitHub says that commit is on
 *                                # main, and refused if GitHub cannot be asked;
 *                                # refused while a screen it changed has no
 *                                # passing design check (plan #1534)
 *   npx tsx scripts/plan.ts built <n> --note "what it built" [--commit <sha>]
 *                                # a step merged into its feature's branch: it
 *                                # stays in progress, carrying the commit, until
 *                                # the feature lands on main
 *   npx tsx scripts/plan.ts land <feature>   # after the feature's branch is on
 *                                # main: closes every step marked built under it,
 *                                # with the same checks done makes
 *   npx tsx scripts/plan.ts answer <n> --note "what was decided"   # a decision
 *   npx tsx scripts/plan.ts block <n> --ask "what it needs" [--note "the rest"]
 *                                [--on-steps]   # waiting on the steps it names,
 *                                # rather than on something only you can supply
 *   npx tsx scripts/plan.ts drop <n> --note "why not"
 *   npx tsx scripts/plan.ts reopen <n>
 *   npx tsx scripts/plan.ts stopped <n> --reason "why, in one line" [--piece "…" --piece "…"]
 *                                # ending a run with the step neither closed nor
 *                                # blocked: the reason goes on the run, and the
 *                                # pieces are the split a too-big step would take
 *   npx tsx scripts/plan.ts activity <n> --kind thought|action|question|error --body "…"
 *                                [--option "…" ...]   # one line on the run fired at <n> (or
 *                                # the feature above it), shown live on the run's page; a
 *                                # question takes 1-10 options and parks the run on you
 *   npx tsx scripts/plan.ts response <n>   # your answer to the run's last question, or
 *                                # "No answer yet"; what a session that asked reads back
 *   npx tsx scripts/plan.ts update <feature> --health on_track|at_risk|blocked --body "…"
 *                                [--run <plan_runs id>]   # Dash's update on a feature, at
 *                                # the end of a build or re-shape run; the step counts
 *                                # are worked out from the plan
 *   npx tsx scripts/plan.ts assign <n> me|none
 *   npx tsx scripts/plan.ts priority <n> 1|2|3
 *   npx tsx scripts/plan.ts depends <n> --on <m>
 *   npx tsx scripts/plan.ts undepend <n> --on <m>
 *
 * Steps are named by their outline, the "#1073.4" a row on the page heads
 * itself with: the fourth step under feature #1073. Every step this prints is
 * named that way, and every <n> above takes an outline (1073.4 or #1073.4) or
 * a step's number. Text written through here is stored as written, so a
 * session writes the outline there too. Older text that names a step by its
 * number (#1084) is shown with the outline (lib/plan/ref.ts); the number is
 * still the row's identity in the database.
 *
 * Which account: `--user <id or email prefix>`, or PLAN_USER in the
 * environment; when exactly one account has a plan, that one without asking.
 *
 * Needs DATABASE_URL (service role). The reading -- nesting, what is ready,
 * the brief -- is lib/plan/tree.ts and lib/plan/brief.ts, the same code the
 * page runs, so the two cannot disagree about what is next.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { findDuplicateIdea, ideaFirstLine } from '../lib/ideas/duplicate';
import { FILED_IDEAS_SQL } from '../lib/ideas/load';
import { IDEA_WINDOW_MINUTES, ideaAllowance, ideaCapRefusal } from '../lib/ideas/rate';
import { isModuleId } from '../lib/modules';
import { isAppScope, isPlanScope, planScopeLabel, planScopeOf } from '../lib/plan/projects';
import { planBrief, STATUS_WORD } from '../lib/plan/brief';
import { importedBy, pagesUsing } from '../lib/preview/importers';
import { surfacesForFiles } from '../lib/preview/routes';
import { uiCheckRefusal, type CheckRound } from '../lib/plan/ui-check-guard';
import { stepScreenInputs } from '../lib/plan/ui-check-local';
import type { VisionBodies } from '../lib/specs/vision';
import { closeRefusal, commitOnMain } from '../lib/plan/github';
import { runLine, runResponse, statusAfterLine } from '../lib/plan/run-line';
import { runForStop, stopColumns, stopLine, stopRefusal } from '../lib/plan/stop-reason';
import { branchesContaining } from '../lib/plan/branches';
import {
  needsLines,
  needsRefusal,
  releasesBlock,
  SETUP_ASSIGNEE,
  SETUP_KIND,
  setupHome,
  setupStartRefusal,
} from '../lib/plan/needs';
import { addsAsProposal, currentSession, reshapeStamp, sessionStamp } from '../lib/plan/origin';
import {
  CHECK_BACK_COLUMNS,
  checkBackFrom,
  dueWords,
  isDue,
  MAX_DELAY_MS,
  parseDelay,
  type CheckBack,
} from '../lib/plan/check-backs';
import { blockAskRefusal } from '../lib/plan/block-ask';
import { CLAIM_WORD, type ClaimRun } from '../lib/plan/liveness';
import {
  isPlanUpdateHealth,
  PLAN_UPDATE_BODY_MAX,
  PLAN_UPDATE_HEALTH,
  PLAN_UPDATE_HEALTHS,
  progressSince,
  updateCounts,
} from '../lib/plan/updates';
import { storedReading } from '../lib/plan/run-end';
import {
  numberFromRef,
  outlineIndex,
  readableRefs,
  refFor,
  stepRef,
  type OutlineIndex,
} from '../lib/plan/ref';
import { CONSEQUENCE_SHAPE, consequenceFrom, parseConsequenceArg } from '../lib/raised/consequence';
import type { SpendReport } from '../lib/core/spend/pricing';
import { checkWriting, writingNote, writingWarning, type WritingText } from '../lib/writing/check';
import { writingSpendRow } from '../lib/writing/ledger';
import {
  blockPatch,
  isClosed,
  isDismissed,
  isPlanKind,
  isPlanPriority,
  isPlanSize,
  planItemFromRow,
  type PlanData,
  type PlanItem,
  type PlanStatus,
} from '../lib/plan/load';
import {
  buildPlanTree,
  findNode,
  flattenSections,
  isClaudes,
  planLiveness,
  summarize,
  workOrder,
  type PlanLiveness,
  type PlanNode,
  type PlanSection,
} from '../lib/plan/tree';

/**
 * A direct connection rather than lib/db/admin.ts: that module is marked
 * server-only and throws under plain node. Same service-role credentials,
 * same responsibility to filter by user_id explicitly -- which every query
 * below does, through `userId`.
 */
function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. It is needed to read the plan.');
    process.exit(1);
  }
  return postgres(url, { max: 2, prepare: false, onnotice: () => {} });
}

type Sql = ReturnType<typeof connect>;

/**
 * Score what was just written into a plan row against docs/WRITING-GUIDE.md
 * (plan #1175): a warning printed to the session naming each pattern found,
 * and at the higher score a one-line note on the row's comment. Nothing when
 * the text is clean.
 *
 * Never refuses or undoes the write, and never fails the command: the row is
 * already saved, and a check that could not run is the same as a clean one.
 * Jev is asked only for an account with core.account_settings.jev_enabled on;
 * any other account gets the rules for the guide's own examples.
 */
async function checkRowWriting(
  sql: Sql,
  userId: string,
  row: { id: string; number: number },
  text: WritingText,
): Promise<void> {
  try {
    let enabled = false;
    try {
      const [settings] = await sql<{ jev_enabled: boolean | null }[]>`
        select jev_enabled from core.account_settings where user_id = ${userId}`;
      enabled = settings?.jev_enabled === true;
    } catch {
      // No core schema or no column: send nothing.
    }

    const reports: SpendReport[] = [];
    const result = await checkWriting({ text, enabled, onSpend: (report) => reports.push(report) });
    for (const report of reports) {
      await sql`insert into core.model_spend ${sql(writingSpendRow(userId, report))}`.catch(() => {});
    }

    const warning = writingWarning(result);
    if (warning) console.warn(`${ref(row.number)} ${warning}`);
    const note = writingNote(result, new Date().toISOString().slice(0, 10));
    if (note) {
      await sql`
        update plan_items set comment = coalesce(comment || E'\n\n', '') || ${note}
        where id = ${row.id} and user_id = ${userId}`;
    }
  } catch (error) {
    console.warn(`Writing check did not run: ${error instanceof Error ? error.message : error}`);
  }
}

const argv = process.argv.slice(2);

function arg(flag: string): string | null {
  const index = argv.indexOf(flag);
  return index > -1 ? (argv[index + 1] ?? null) : null;
}

/** Every value a repeatable flag was given, in order. */
function args(flag: string): string[] {
  const out: string[] = [];
  argv.forEach((value, index) => {
    if (value === flag && argv[index + 1] !== undefined) out.push(argv[index + 1]);
  });
  return out;
}

function has(flag: string): boolean {
  return argv.includes(flag);
}

/** The positional arguments: the command, then whatever it names. */
function positional(): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value.startsWith('--')) {
      // Flags that take a value swallow the next argument; bare ones do not.
      if (!['--all', '--claude', '--proposed'].includes(value)) i += 1;
      continue;
    }
    out.push(value);
  }
  return out;
}

function fail(message: string): never {
  console.error(readable(message));
  process.exit(1);
}

function currentCommit(): string | null {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function currentBranch(): string | null {
  try {
    const name = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    return name && name !== 'HEAD' ? name : null;
  } catch {
    return null;
  }
}

/** The dated line `built` writes, which `land` looks for as the step's last. */
const BUILT_LINE = /^Built \d{4}-\d{2}-\d{2}\b/;

/**
 * Why a step may not close as done against this commit, or null when it may.
 *
 * The commit a closed step carries is the record of where the work went,
 * and everything downstream trusts it: the page draws it, the CI mark
 * reads its checks, and a person reading back through the plan takes it
 * for shipped. A close against a commit that only ever existed on a
 * branch makes all of that false, so it is refused here rather than
 * noticed later. An answer GitHub would not give is refused too --
 * `closeRefusal` says why -- because a check that passes when it could
 * not ask is the check that let this through.
 *
 * A step that changed a screen closes only once each surface it touched
 * has passed the design critic (plan #1534). Git that cannot read the
 * step's files refuses too: a guard that cannot look does not wave the
 * close through. Shared by `done` and `land`.
 */
async function doneRefusal(
  sql: Sql,
  userId: string,
  number: number,
  commit: string,
): Promise<string | null> {
  const landing = await commitOnMain({ sha: commit });
  const refusal = closeRefusal({ sha: commit, landing, branches: branchesContaining(commit) });
  if (refusal) return refusal;

  let inputs: { files: string[]; surfaces: string[] };
  try {
    inputs = stepScreenInputs(number, commit, outlines.get(number));
  } catch (error) {
    return (
      `Could not read what ${ref(number)} changed at ${commit} to check its screens ` +
      `(${error instanceof Error ? error.message : String(error)}). Run git fetch origin and try again.`
    );
  }
  const checks = inputs.surfaces.length
    ? await sql<CheckRound[]>`
        select surface, round, verdict from ui_checks
        where user_id = ${userId} and step = ${number}`
    : [];
  return uiCheckRefusal({ step: number, ...inputs, checks });
}

/**
 * The gallery surfaces a step's files serve, for its brief: the files of its
 * commit once it has one, and otherwise what this branch has changed since it
 * left main, committed or not. Empty where git cannot answer.
 */
function changedSurfaces(commitSha: string | null): string[] {
  try {
    const command = commitSha
      ? `git show --name-only --format= ${commitSha}`
      : 'git diff --name-only $(git merge-base origin/main HEAD)';
    const files = execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n')
      .filter(Boolean);
    if (files.length === 0) return [];
    const graph = importedBy(process.cwd());
    return surfacesForFiles(files, (file) => pagesUsing(file, graph));
  } catch {
    return [];
  }
}

async function resolveUser(sql: Sql): Promise<string> {
  const wanted = arg('--user') ?? process.env.PLAN_USER ?? null;
  if (wanted) {
    const rows = await sql<{ id: string }[]>`
      select id from auth.users
      where id::text like ${`${wanted}%`} or email like ${`${wanted}%`}`;
    if (rows.length === 1) return rows[0].id;
    fail(rows.length === 0 ? `No account matches "${wanted}".` : `"${wanted}" matches ${rows.length} accounts.`);
  }

  const owners = await sql<{ user_id: string }[]>`select distinct user_id from plan_items`;
  if (owners.length === 1) return owners[0].user_id;
  if (owners.length === 0) {
    const users = await sql<{ id: string }[]>`select id from auth.users`;
    if (users.length === 1) return users[0].id;
  }
  return fail('More than one account here. Say which with --user <id or email>.');
}

async function loadData(sql: Sql, userId: string): Promise<PlanData> {
  const rows = await sql<Record<string, unknown>[]>`
    select id, number, module, parent_id, title, detail, acceptance, status, kind,
           resolution, comment, block_ask, block_kind, priority, size, assignee, commit_sha,
           position,
           started_at, completed_at, created_at, dismissed_at
    from plan_items where user_id = ${userId}
    order by position, created_at`;
  const deps = await sql<{ id: string; item_id: string; depends_on_id: string }[]>`
    select id, item_id, depends_on_id from plan_dependencies where user_id = ${userId}`;
  return {
    items: rows.map(planItemFromRow),
    dependencies: deps.map((d) => ({ id: d.id, itemId: d.item_id, dependsOnId: d.depends_on_id })),
  };
}

/**
 * The last run against each step, as the claim rules read it.
 *
 * The same read `loadLastRuns` does over the app's client, done here over the
 * direct connection: there is no Supabase client in a script, and a terminal
 * that answered "underway" while the page said the run stopped hours ago is
 * exactly the disagreement #500 is about. Newest first, one per step.
 */
async function loadRuns(sql: Sql, userId: string): Promise<Record<string, ClaimRun>> {
  const rows = await sql<Record<string, unknown>[]>`
    select plan_item_id, status, created_at, github_checked_at, last_push_at, last_push_sha,
           last_push_subject, github_error
    from plan_runs
    where user_id = ${userId} and plan_item_id is not null
    order by created_at desc`;
  // A direct connection hands back Dates where PostgREST hands back strings.
  const stamp = (value: unknown): string | null =>
    value instanceof Date ? value.toISOString() : value == null ? null : String(value);

  const runs: Record<string, ClaimRun> = {};
  for (const row of rows) {
    const stepId = String(row.plan_item_id);
    if (runs[stepId]) continue;
    runs[stepId] = {
      status: String(row.status ?? ''),
      createdAt: stamp(row.created_at) ?? '',
      reading: storedReading({
        github_checked_at: stamp(row.github_checked_at),
        last_push_at: stamp(row.last_push_at),
        last_push_sha: stamp(row.last_push_sha),
        last_push_subject: stamp(row.last_push_subject),
        github_error: stamp(row.github_error),
      }),
    };
  }
  return runs;
}

/** The tree, and what the runs say about the steps claimed in it. */
async function loadState(
  sql: Sql,
  userId: string,
): Promise<{ sections: PlanSection[]; liveness: PlanLiveness }> {
  const data = await loadData(sql, userId);
  const liveness = planLiveness(data.items, await loadRuns(sql, userId), Date.now());
  const sections = buildPlanTree(data, liveness);
  // The tree is built anyway, so its outlines become the names this run uses.
  outlines = outlineIndex(sections.flatMap((section) => section.nodes));
  outlinesLoaded = true;
  return { sections, liveness };
}

/** The visions written on the specs page, by scope; the app's is under `app`. */
async function loadVisions(sql: Sql, userId: string): Promise<VisionBodies> {
  const rows = await sql<{ module: string; body: string }[]>`
    select module, body from module_visions where user_id = ${userId}`;
  return Object.fromEntries(rows.map((row) => [row.module, row.body])) as VisionBodies;
}

async function loadTree(sql: Sql, userId: string): Promise<PlanSection[]> {
  return (await loadState(sql, userId)).sections;
}

/**
 * Every step's outline by its number, for naming steps to the person and for
 * reading the outlines they and sessions write. Empty until a command loads
 * it; `ref` and `readable` then fall back to the number, which is still right.
 */
let outlines: OutlineIndex = new Map();
let outlinesLoaded = false;

/** The outline index, read once per command, or again with `fresh` after a row is added. */
async function loadOutlines(sql: Sql, userId: string, fresh = false): Promise<OutlineIndex> {
  if (outlinesLoaded && !fresh) return outlines;
  const sections = buildPlanTree(await loadData(sql, userId));
  outlines = outlineIndex(sections.flatMap((section) => section.nodes));
  outlinesLoaded = true;
  return outlines;
}

/** `#1073.4` for a step's number. */
function ref(number: number): string {
  return refFor(number, outlines);
}

/** A step as it is typed in a command, `1073.4`, without the `#`. */
function typed(number: number): string {
  return ref(number).slice(1);
}

/** Stored text as the person reads it: each step's `#1084` shown as `#1073.4`. */
function readable(text: string): string {
  return readableRefs(text, outlines);
}

async function byNumber(sql: Sql, userId: string, raw: string | undefined): Promise<PlanItem> {
  const number = numberFromRef(String(raw ?? ''), await loadOutlines(sql, userId));
  if (number === null || !Number.isInteger(number) || number < 1) {
    fail(`Give a step by its outline, the "#1073.4" on the page, or its number. "${raw ?? ''}" names no step.`);
  }
  const rows = await sql<Record<string, unknown>[]>`
    select id, number, module, parent_id, title, detail, acceptance, status, kind,
           resolution, comment, block_ask, block_kind, priority, size, assignee, commit_sha,
           position,
           started_at, completed_at, created_at, dismissed_at
    from plan_items where user_id = ${userId} and number = ${number}`;
  if (rows.length === 0) fail(`No step ${raw?.startsWith('#') ? raw : `#${raw}`}.`);
  return planItemFromRow(rows[0]);
}

const GLYPH: Record<PlanStatus, string> = {
  proposed: '[?]',
  not_started: '[ ]',
  in_progress: '[>]',
  blocked: '[!]',
  done: '[x]',
  dropped: '[-]',
};

function facts(node: PlanNode, liveness?: PlanLiveness): string {
  const out: string[] = [];
  // What the run behind a claim is doing, where there is one to read. The
  // status box says "[>]" for all four readings; this says which.
  const claim = liveness?.[node.id];
  if (claim && claim !== 'claimed') out.push(CLAIM_WORD[claim]);
  // First, because it changes what every other fact on the line means: a
  // question that is "ready" is ready for the person, not for a session.
  if (node.kind === 'decision') out.push(node.status === 'done' ? 'answered' : 'DECISION');
  if (node.priority !== 2) out.push(`p${node.priority}`);
  if (node.size) out.push(node.size.toUpperCase());
  if (node.assignee) out.push(node.assignee);
  if (node.waitingOn.length > 0 && !isClosed(node.status)) {
    out.push(`waits ${node.waitingOn.map((wait) => stepRef(wait)).join(',')}`);
  }
  if (node.children.length > 0 && node.rollup.live > 0) {
    out.push(`${node.rollup.done}/${node.rollup.live}`);
  }
  if (node.ready) out.push('ready');
  return out.join('  ');
}

function printNode(node: PlanNode, indent = '', liveness?: PlanLiveness): void {
  // Put aside as not right now, so it is not asked here either. It is on
  // /dev/plan under Dismissed, which is the one place it shows.
  if (isDismissed(node)) return;
  // An unanswered decision gets "[?]" where a build step gets its status box,
  // so a session scanning the list sees what is a question before it reads a
  // word of the title. An answered one keeps "[x]": it is closed either way.
  // Round rather than square, and unlike the "[?]" a proposal wears: this is
  // not a box waiting to be ticked, it is a question waiting to be answered.
  const glyph = node.kind === 'decision' && !isClosed(node.status) ? '(?)' : GLYPH[node.status];
  // Headed by its outline, the "#1073.4" the row on the page shows.
  const head = `${indent}${stepRef(node).padEnd(9)}${glyph}  ${readable(node.title)}`;
  const tail = facts(node, liveness);
  console.log(tail ? `${head.padEnd(64)}  ${tail}` : head);
  for (const child of node.children) printNode(child, indent + '  ', liveness);
}

/**
 * Ideas from a markdown file, one per `## ` heading.
 *
 * A review that ends in fifteen ideas should not end in fifteen commands typed
 * by hand, and a file in the repo is also a record of where the ideas came
 * from. The heading is the idea's first line and the paragraphs under it are
 * the rest; a line reading `module: jobs` scopes it to a workspace and is not
 * part of the body.
 */
function ideasFromFile(path: string): { body: string; module: PlanItem['module'] }[] {
  const text = readFileSync(path, 'utf8');
  const out: { body: string; module: PlanItem['module'] }[] = [];
  for (const chunk of text.split(/^## /m).slice(1)) {
    const [heading, ...rest] = chunk.split('\n');
    let scope: PlanItem['module'] = null;
    const lines = rest.filter((line) => {
      const match = /^module:\s*(\S+)\s*$/.exec(line);
      if (!match) return true;
      if (!isModuleId(match[1])) fail(`"${match[1]}" is not a module (under "${heading}").`);
      scope = match[1];
      return false;
    });
    const body = `${heading.trim()}\n\n${lines.join('\n').trim()}`.trim();
    if (body) out.push({ body, module: scope });
  }
  return out;
}

function moduleLabel(module: PlanItem['module']): string {
  return planScopeLabel(module);
}

/** Keep only the steps a predicate wants, and the way down to them. */
function keep(nodes: PlanNode[], want: (node: PlanNode) => boolean): PlanNode[] {
  return nodes.flatMap((node) => {
    const children = keep(node.children, want);
    if (!want(node) && children.length === 0) return [];
    return [{ ...node, children }];
  });
}

type RaisedComment = { author: 'me' | 'claude'; body: string };

type RaisedListRow = {
  id: string;
  title: string;
  detail: string | null;
  ask: string | null;
  consequence: unknown;
  module: string | null;
  source: string | null;
  status: string;
  created_at: Date;
  comments: RaisedComment[] | null;
};

function lastAuthor(row: RaisedListRow): string | null {
  const comments = row.comments ?? [];
  return comments.length === 0 ? null : comments[comments.length - 1].author;
}

function printCheckBack(row: CheckBack, now: number): void {
  const when = row.status === 'waiting' ? `due ${dueWords(row.dueAt, now)}` : row.status;
  console.log(`\n${row.id.slice(0, 8)}  ${when}  ${readable(row.title)}`);
  if (row.source) console.log(`  from ${readable(row.source)}`);
  if (row.detail) console.log(`  ${readable(row.detail).replace(/\s+/g, ' ')}`);
  if (row.wokeAt) console.log(`  a session was woken for it at ${row.wokeAt}`);
  if (!row.wake && row.status === 'waiting') console.log('  waits for a session: the tick will not wake one');
  if (row.outcome) console.log(`  found: ${readable(row.outcome).replace(/\s+/g, ' ')}`);
}

async function loadCheckBacks(sql: Sql, userId: string, all: boolean): Promise<CheckBack[]> {
  const rows = await sql<Record<string, unknown>[]>`
    select ${sql.unsafe(CHECK_BACK_COLUMNS)}
    from check_backs
    where user_id = ${userId}
      and (${all} or status = 'waiting' or closed_at > now() - interval '2 days')
    order by (status = 'waiting') desc, due_at`;
  return rows.map((row) =>
    checkBackFrom({
      ...row,
      due_at: (row.due_at as Date).toISOString(),
      created_at: (row.created_at as Date).toISOString(),
      closed_at: row.closed_at ? (row.closed_at as Date).toISOString() : null,
      woke_at: row.woke_at ? (row.woke_at as Date).toISOString() : null,
    }),
  );
}

function printRaise(row: RaisedListRow): void {
  const scope = row.module && isModuleId(row.module) ? row.module : null;
  console.log(`\n${row.id.slice(0, 8)}  ${moduleLabel(scope)}  ${readable(row.title)}`);
  if (row.source) console.log(`  raised by ${readable(row.source)}`);
  // The ask above the story, the same order the page reads it in.
  if (row.ask) console.log(`  asks: ${readable(row.ask).replace(/\s+/g, ' ')}`);
  const consequence = consequenceFrom(row.consequence, scope);
  if (consequence) console.log(`  a yes: ${readable(consequence.said).replace(/\s+/g, ' ')}`);
  if (row.detail) console.log(`  ${readable(row.detail).replace(/\s+/g, ' ')}`);
  for (const comment of row.comments ?? []) {
    console.log(`  ${comment.author === 'me' ? 'user' : 'claude'}: ${readable(comment.body).replace(/\s+/g, ' ')}`);
  }
}

async function main(): Promise<void> {
  const [command = 'list', target, extra] = positional();
  const sql = connect();
  const userId = await resolveUser(sql);

  try {
    // Every command names steps or reads a name, so the outlines are loaded
    // first. `list` and `next` build the tree themselves and take them from it.
    if (command !== 'list' && command !== 'next') await loadOutlines(sql, userId);

    if (command === 'list') {
      const { sections, liveness } = await loadState(sql, userId);
      const all = has('--all');
      const onlyModule = arg('--module');
      const claude = has('--claude');
      let shown = 0;

      for (const section of sections) {
        if (onlyModule && section.module !== onlyModule) continue;
        const nodes = keep(
          section.nodes,
          // `--claude` asks the same question the Dash view on the page asks,
          // and `isClaudes` is where that question is answered.
          (node) => (all || !isClosed(node.status)) && (!claude || isClaudes(node)),
        );
        if (nodes.length === 0) continue;
        const { done, live } = section.progress;
        console.log(`\n== ${section.label}${live ? ` (${done} of ${live} done)` : ''}`);
        for (const node of nodes) printNode(node, '', liveness);
        shown += flattenSections([{ ...section, nodes }]).length;
      }

      const summary = summarize(sections);
      if (shown === 0) {
        console.log(summary.total === 0 ? 'No plan yet.' : 'Nothing open under that filter.');
      }
      console.log(
        `\n${summary.open} open: ${summary.ready} ready, ${summary.inProgress} underway, ` +
          `${summary.waiting} waiting, ${summary.claude} with Claude, ` +
          `${summary.onYou} on the user. ${summary.done} done.`,
      );
      return;
    }

    if (command === 'ideas') {
      // Dismissed ones are left out, which is what dismissing them was for: an
      // idea the user has put aside is not offered back to the session that
      // would suggest it again.
      const rows = await sql<{ id: string; body: string; module: string | null; created_at: Date }[]>`
        select id, body, module, created_at from ideas
        where user_id = ${userId} and plan_item_id is null and dismissed_at is null
        order by created_at desc`;
      if (rows.length === 0) {
        console.log('Every idea has been shaped into the plan, or there are none.');
        return;
      }
      for (const row of rows) {
        const scope = row.module && isModuleId(row.module) ? row.module : null;
        console.log(
          `${row.id.slice(0, 8)}  ${moduleLabel(scope).padEnd(18)}  ${readable(row.body).replace(/\s+/g, ' ').slice(0, 90)}`,
        );
      }
      return;
    }

    /**
     * Filing a follow-on: anything the feature in front of you can ship
     * without.
     *
     * Everything written here is a suggestion: this command is how a session
     * writes an idea, and the user writes theirs on the page or from the
     * capture panel. So the row is stamped `claude`, the ideas page lists it
     * under their own, and `--from <n>` says which step the session was on
     * when it thought of it.
     *
     * It reads the page before writing to it. Sessions wrote 53 of the 55
     * ideas that were open when this check was added, over four days, several
     * of them the same thought in different words, because nothing here
     * looked first. An idea close to one already filed is refused and the
     * refusal names what it matched (lib/ideas/duplicate.ts), and a session
     * gets two an hour (lib/ideas/rate.ts) so one run cannot add ten rows to
     * a list somebody has to read.
     */
    if (command === 'idea') {
      const file = arg('--file');
      const moduleArg = arg('--module');
      if (moduleArg && !isModuleId(moduleArg)) fail(`"${moduleArg}" is not a module.`);
      const from = arg('--from');
      const step = from ? await byNumber(sql, userId, from) : null;
      const ideas = file
        ? ideasFromFile(file)
        : target?.trim()
          ? [{ body: target.trim(), module: moduleArg && isModuleId(moduleArg) ? moduleArg : null }]
          : [];
      if (ideas.length === 0) {
        fail('Give the idea: idea "…" [--module <id>] [--from <outline>], or idea --file <path> with a "## " heading per idea.');
      }
      /**
       * What a new idea is checked against, read through the statement in
       * lib/ideas/load.ts so this command and the nightly run compare against
       * the same list. An idea you put aside is in it (#646), so a session
       * cannot file by hand the suggestion you turned down last week.
       */
      const filed = await sql.unsafe<{ id: string; body: string }[]>(FILED_IDEAS_SQL, [userId]);
      /**
       * What the cap is counted against: every idea a session wrote inside
       * the window, whatever became of it since. Shaped and dismissed rows
       * are counted too, because each one was still a row somebody had to
       * read.
       */
      const sessionFilings = await sql<{ created_at: Date }[]>`
        select created_at from ideas
        where user_id = ${userId} and source = 'claude'
          and created_at > now() - make_interval(mins => ${IDEA_WINDOW_MINUTES})
        order by created_at desc`;
      const filedAt = sessionFilings.map((row) => row.created_at.getTime());

      const refusals: string[] = [];
      const capped: string[] = [];
      let written = 0;
      for (const idea of ideas) {
        if (idea.body.length > 4000) fail(`An idea is at most 4000 characters: "${idea.body.slice(0, 40)}…"`);
        // Re-read each time round, so one --file of ten stops at the cap too.
        if (!ideaAllowance(filedAt, Date.now()).allowed) {
          capped.push(ideaFirstLine(idea.body));
          continue;
        }
        const match = findDuplicateIdea(idea.body, filed);
        if (match) {
          refusals.push(
            `"${ideaFirstLine(idea.body)}" — ${Math.round(match.score * 100)}% the same ` +
              `${match.on === 'body' ? 'words' : 'first line'} as ` +
              `${match.idea.id.slice(0, 8)} "${ideaFirstLine(match.idea.body)}"`,
          );
          continue;
        }
        const [row] = await sql<{ id: string }[]>`
          insert into ideas (user_id, body, module, source, from_plan_item_id)
          values (${userId}, ${idea.body}, ${idea.module}, 'claude', ${step?.id ?? null})
          returning id`;
        // Checked against too, so one --file cannot carry the same idea twice.
        filed.unshift({ id: row.id, body: idea.body });
        filedAt.unshift(Date.now());
        written += 1;
        console.log(
          `${row.id.slice(0, 8)}  ${moduleLabel(idea.module).padEnd(18)}  ${readable(idea.body).replace(/\s+/g, ' ').slice(0, 90)}`,
        );
      }

      if (refusals.length > 0) {
        console.error(`\n${refusals.length} not filed; an idea this close is already there:`);
        for (const line of refusals) console.error(`  ${line}`);
        console.error('Add what is different to the idea that is already there, or leave it.');
      }
      if (capped.length > 0) {
        console.error(`\n${capped.length} not filed; ${ideaCapRefusal(ideaAllowance(filedAt, Date.now()), Date.now())}`);
        for (const line of capped) console.error(`  "${line}"`);
        console.error('Keep the ones worth filing and leave the rest, or file them later.');
      }
      if (written === 0) process.exit(1);
      console.log(
        `\n${written} filed as suggestions${step ? ` from ${ref(step.number)}` : ''}. ` +
          'They are on /dev/ideas, under the user\'s own list.',
      );
      return;
    }

    /**
     * Raising something, which is a session asking you for what belongs to no
     * step: a risk it found in code it was only passing through, a question of
     * taste, a thing it will not decide alone. A decision belongs to one
     * feature and the notes queue is what you report as wrong; this is the
     * third home, and it is read on /dev/inbox.
     *
     * A session never answers or dismisses its own raise, the same rule as
     * never answering its own decision, so there is no command for either.
     */
    if (command === 'raise') {
      const title = target?.trim();
      if (!title) {
        fail(
          'Give the raise: raise "…" --ask "…" --consequence "<action>: <what>"\n' +
            '[--detail "…"] [--module <id>] [--from <outline>].',
        );
      }
      if (title.length > 200) fail('A title is at most 200 characters.');

      const moduleArg = arg('--module');
      if (moduleArg && !isModuleId(moduleArg)) fail(`"${moduleArg}" is not a module.`);
      const detail = arg('--detail');
      if (detail && detail.length > 4000) fail('A detail is at most 4000 characters.');

      /**
       * The ask is required, and it is the whole point of the row. A raise
       * without one is a session narrating: it reads as a report, the user
       * cannot tell what is wanted, and the page fills with paragraphs nobody
       * can clear. One sentence they can answer in one line -- a question with
       * your recommendation, an action to approve, or a named choice.
       */
      const ask = arg('--ask')?.trim();
      if (!ask) {
        fail(
          'A raise needs --ask: the question, action or choice, in one sentence the user can\n' +
            'answer in one line. Say what you recommend. The detail is the evidence for it.',
        );
      }
      if (ask.length > 500) fail('An ask is at most 500 characters.');

      /**
       * What a yes does, named here rather than worked out when it is
       * answered. The #342 raise was answered yes, closed, and produced
       * nothing; a named action is what #365 runs, so a raise that cannot name
       * one is a raise that is not ready to be asked.
       */
      const scope = moduleArg && isModuleId(moduleArg) ? moduleArg : null;
      const consequenceArg = arg('--consequence')?.trim();
      if (!consequenceArg) {
        fail(
          `A raise needs --consequence: what a yes does, written as "${CONSEQUENCE_SHAPE}".\n` +
            'Say the action in the same words a comment instruction uses, so answering runs it\n' +
            'rather than leaving you to. A yes that does nothing is what this column exists for.',
        );
      }
      const consequence = parseConsequenceArg(consequenceArg, scope);
      if (!consequence.ok) fail(consequence.why);

      const from = arg('--from');
      const step = from ? await byNumber(sql, userId, from) : null;
      const source = arg('--source') ?? (step ? `plan ${ref(step.number)}` : null);

      const [row] = await sql<{ id: string }[]>`
        insert into raised_items (user_id, module, title, detail, ask, consequence, source)
        values (${userId}, ${scope}, ${title},
                ${detail}, ${ask}, ${sql.json(consequence.action)}, ${source})
        returning id`;
      console.log(`${row.id.slice(0, 8)}  raised: ${readable(title)}`);
      console.log(`a yes: ${readable(consequence.said)}`);
      console.log('It is on /dev/inbox, and in the bell until it is answered or dismissed.');
      return;
    }

    /**
     * What is outstanding in both directions: what you have not answered, and
     * what you answered that no session has replied to. The second half is
     * what a run reads at the start, since an answer written while nothing was
     * awake is otherwise never picked up.
     */
    if (command === 'raises') {
      const rows = await sql<RaisedListRow[]>`
        select r.id, r.title, r.detail, r.ask, r.consequence, r.module, r.source, r.status,
               r.created_at,
               (
                 select json_agg(
                          json_build_object('author', c.author, 'body', c.body)
                          order by c.created_at
                        )
                 from core.thread_turns c
                 where c.ref = 'public.raised_items:' || r.id and c.user_id = r.user_id
               ) as comments
        from raised_items r
        where r.user_id = ${userId} and r.status in ('open', 'answered')
        order by r.created_at desc`;

      const open = rows.filter((row) => row.status === 'open');
      const answered = rows.filter(
        (row) => row.status === 'answered' && lastAuthor(row) === 'me',
      );

      // Check-backs are read at the same moment as the raises: the skill's
      // first step is this command, so a due one is seen by every run.
      const now = Date.now();
      const due = (await loadCheckBacks(sql, userId, false)).filter((row) => isDue(row, now));
      const dueLine =
        due.length > 0
          ? `\n${due.length} check-back${due.length === 1 ? ' is' : 's are'} due. Do ${due.length === 1 ? 'it' : 'them'} ` +
            'before the work you came for: npx tsx scripts/plan.ts check-backs'
          : null;

      if (open.length === 0 && answered.length === 0) {
        console.log('Nothing raised is waiting, and every answer has been replied to.');
        if (dueLine) console.log(dueLine);
        return;
      }

      if (open.length > 0) {
        console.log('\n== Waiting on the user');
        for (const row of open) printRaise(row);
      }
      if (answered.length > 0) {
        console.log('\n== Answered, not yet replied to');
        for (const row of answered) printRaise(row);
      }
      if (dueLine) console.log(dueLine);
      return;
    }

    /**
     * Coming back to something after some time. The next session to run once
     * it falls due picks it up (the line under `raises`), and the tick wakes
     * one when none has within the hour (inngest/dev/check-backs.ts). Use it
     * where a routine on the account would otherwise be scheduled: this one is
     * on the Dash tab, and any session can finish it.
     */
    if (command === 'check-back') {
      const title = target?.trim();
      if (!title) fail('Give it: check-back "<what to look at>" --after 2h [--detail "…"].');
      if (title.length > 200) fail('A title is at most 200 characters.');
      const detail = arg('--detail')?.trim() || null;
      if (detail && detail.length > 4000) fail('A detail is at most 4000 characters.');

      const after = arg('--after');
      const at = arg('--at');
      if (Boolean(after) === Boolean(at)) fail('Say when, with exactly one of --after 2h|90m|1d or --at <ISO time>.');
      let dueAt: Date;
      if (after) {
        const delay = parseDelay(after);
        if (delay === null) fail(`"${after}" is not a delay: write 90m, 2h, 1d or 1h30m, up to 30d.`);
        dueAt = new Date(Date.now() + delay);
      } else {
        dueAt = new Date(at!);
        if (Number.isNaN(dueAt.getTime())) fail(`"${at}" is not a time: write it like 2026-09-26T02:20:00Z.`);
        if (dueAt.getTime() - Date.now() > MAX_DELAY_MS) fail('A check-back is at most 30 days away.');
      }

      const from = arg('--from');
      const step = from ? await byNumber(sql, userId, from) : null;
      const source = arg('--source') ?? (step ? `plan ${ref(step.number)}` : null);
      const wake = !has('--no-wake');

      const [row] = await sql<{ id: string }[]>`
        insert into check_backs (user_id, title, detail, due_at, plan_item_id, source, wake)
        values (${userId}, ${title}, ${detail}, ${dueAt}, ${step?.id ?? null}, ${source}, ${wake})
        returning id`;
      console.log(`${row.id.slice(0, 8)}  due ${dueWords(dueAt.toISOString(), Date.now())}: ${readable(title)}`);
      console.log(
        wake
          ? 'The next session after it falls due picks it up; an hour past due, the tick wakes one.'
          : 'The next session after it falls due picks it up. The tick will not wake one for it.',
      );
      return;
    }

    if (command === 'check-backs') {
      const now = Date.now();
      const rows = await loadCheckBacks(sql, userId, has('--all'));
      const due = rows.filter((row) => isDue(row, now));
      const coming = rows.filter((row) => row.status === 'waiting' && !isDue(row, now));
      const closed = rows.filter((row) => row.status !== 'waiting');
      if (rows.length === 0) {
        console.log('No check-backs.');
        return;
      }
      if (due.length > 0) {
        console.log('\n== Due: do these now, then close each with `checked <id> --note "…"`');
        for (const row of due) printCheckBack(row, now);
      }
      if (coming.length > 0) {
        console.log('\n== Coming up');
        for (const row of coming) printCheckBack(row, now);
      }
      if (closed.length > 0) {
        console.log('\n== Closed lately');
        for (const row of closed) printCheckBack(row, now);
      }
      return;
    }

    if (command === 'checked') {
      const prefix = target?.trim();
      if (!prefix || !/^[0-9a-f-]{4,36}$/i.test(prefix)) fail('Name it by its id: checked <id> --note "…".');
      const note = arg('--note')?.trim();
      if (!note) fail('Say what the check found, or why it no longer matters: --note "…".');
      if (note.length > 4000) fail('A note is at most 4000 characters.');
      const status = has('--drop') ? 'dropped' : 'done';

      const matches = await sql<{ id: string; title: string }[]>`
        select id, title from check_backs
        where user_id = ${userId} and status = 'waiting' and id::text like ${`${prefix.toLowerCase()}%`}`;
      if (matches.length === 0) fail(`No waiting check-back starts with ${prefix}.`);
      if (matches.length > 1) fail(`${prefix} matches ${matches.length} check-backs; give more of the id.`);

      await sql`
        update check_backs
        set status = ${status}, outcome = ${note}, closed_at = now()
        where id = ${matches[0].id} and user_id = ${userId}`;
      console.log(`${matches[0].id.slice(0, 8)}  ${status}: ${readable(matches[0].title)}`);
      return;
    }

    if (command === 'next') {
      const { sections, liveness } = await loadState(sql, userId);
      const claude = has('--claude');
      const limit = Number(arg('--limit') ?? 10);
      // A project's steps (lib/plan/projects) are built from its own
      // repository by its own routine, so a session here never picks one up
      // unless it asked for that project by name.
      const onlyScope = arg('--module');
      const here = sections.filter((section) =>
        onlyScope ? section.module === onlyScope : isAppScope(section.module),
      );
      const order = workOrder(here, claude ? { only: 'runner' } : {});

      if (order.length === 0) {
        const summary = summarize(sections);
        console.log(
          claude
            ? 'Nothing the runner can take is ready. Approve a step on /dev/plan, or run without --claude.'
            : `Nothing is ready. ${summary.inProgress} underway, ${summary.waiting} waiting.`,
        );
        return;
      }
      for (const node of order.slice(0, limit)) {
        const head = `${stepRef(node).padEnd(9)}p${node.priority}  ${readable(node.title)}`;
        const tail = facts(node, liveness);
        console.log(`${head.padEnd(64)}  ${moduleLabel(node.module)}${tail ? `  ${tail}` : ''}`);
      }
      if (order.length > limit) console.log(`… and ${order.length - limit} more.`);
      return;
    }

    if (command === 'show' || command === 'brief') {
      const item = await byNumber(sql, userId, target);
      const { sections, liveness } = await loadState(sql, userId);
      const node = findNode(sections, item.id);
      if (!node) fail(`${ref(item.number)} is not in the tree.`);
      process.stdout.write(
        readable(
          planBrief(sections, node, {
            liveness,
            visions: await loadVisions(sql, userId),
            surfaces: changedSurfaces(item.commitSha),
          }),
        ),
      );
      return;
    }

    if (command === 'add') {
      const title = target?.trim();
      if (!title) fail('Give the step a title: add "What has to happen".');
      const parentNumber = arg('--parent');
      const parent = parentNumber ? await byNumber(sql, userId, parentNumber) : null;
      const moduleArg = arg('--module');
      // A plan step may belong to a project built elsewhere (lib/plan/projects).
      if (moduleArg && !isPlanScope(moduleArg)) fail(`"${moduleArg}" is not a module or project.`);
      const scope = parent ? parent.module : planScopeOf(moduleArg);
      const priority = Number(arg('--priority') ?? 2);
      if (!isPlanPriority(priority)) fail('Priority is 1 (next), 2 (normal) or 3 (someday).');
      const size = arg('--size');
      if (size && !isPlanSize(size)) fail('Size is s, m or l.');
      const kind = arg('--kind') ?? 'build';
      if (!isPlanKind(kind)) fail('Kind is build, decision or setup.');

      const [last] = parent
        ? await sql<{ position: number }[]>`
            select position from plan_items where user_id = ${userId} and parent_id = ${parent.id}
            order by position desc limit 1`
        : await sql<{ position: number }[]>`
            select position from plan_items
            where user_id = ${userId} and parent_id is null and module is not distinct from ${scope}
            order by position desc limit 1`;

      // Approval stops at the feature (#1095): under a chain nobody left
      // proposed, a new step is ready to build unless --proposed says it
      // waits for the person (a step that acts outside the repository). Under
      // a proposed row anywhere above, it is a proposal whatever the flag
      // said: a decided step inside an undecided feature is a contradiction.
      const ancestors = parent
        ? await sql<{ status: string }[]>`
            with recursive chain as (
              select id, parent_id, status, 0 as depth from plan_items
              where id = ${parent.id} and user_id = ${userId}
              union all
              select p.id, p.parent_id, p.status, chain.depth + 1 from plan_items p
              join chain on p.id = chain.parent_id
              where p.user_id = ${userId}
            )
            select status from chain order by depth`
        : [];
      const proposed = addsAsProposal(
        ancestors.map((a) => a.status),
        has('--proposed'),
      );

      // A setup job is the person's by definition, so it is written as
      // theirs rather than left unassigned for somebody to wonder about.
      // Nothing else is written with an assignee: approving a step is what
      // makes it one the runner may take, and keeping one for yourself is a
      // press on the row rather than a flag here.
      const assignee = kind === SETUP_KIND ? SETUP_ASSIGNEE : null;

      // Where the row came from, when it did not come from a person. The gist
      // is read off the decision's own answer rather than retyped by whoever
      // is adding the step, so a session cannot paraphrase an answer into
      // something that was never said.
      const fromNumber = arg('--from');
      let comment: string | null = null;
      if (fromNumber) {
        const from = await byNumber(sql, userId, fromNumber);
        if (from.kind !== 'decision') fail(`${ref(from.number)} is not a decision.`);
        if (!from.resolution) fail(`${ref(from.number)} has not been answered yet.`);
        comment = reshapeStamp(typed(from.number), from.resolution);
      }

      // A step a session writes ready under an approved feature says so, on
      // its own line, so the page can mark it and offer the drop. A person at
      // their own terminal has no session and writes no stamp.
      const session = currentSession(process.env);
      const stamped = parent && !proposed && kind === 'build' && session !== undefined;
      if (stamped) {
        const line = sessionStamp({ session, date: new Date().toISOString().slice(0, 10) });
        comment = comment ? `${comment}\n${line}` : line;
      }

      const [row] = await sql<{ id: string; number: number }[]>`
        insert into plan_items (user_id, module, parent_id, title, detail, acceptance,
                                kind, priority, size, assignee, status, position,
                                comment)
        values (${userId}, ${scope}, ${parent?.id ?? null}, ${title},
                ${arg('--detail')}, ${arg('--done-when')}, ${kind},
                ${priority}, ${size}, ${assignee},
                ${proposed ? 'proposed' : 'not_started'},
                ${(last?.position ?? 0) + 10}, ${comment})
        returning id, number`;
      // Read again, so the new row is named by the outline it just took.
      await loadOutlines(sql, userId, true);

      const ideaPrefix = arg('--idea');
      if (ideaPrefix) {
        const linked = await sql<{ id: string }[]>`
          update ideas set plan_item_id = ${row.id}
          where user_id = ${userId} and id::text like ${`${ideaPrefix}%`} and plan_item_id is null
          returning id`;
        if (linked.length !== 1) {
          console.error(
            linked.length === 0
              ? `No unshaped idea starts with ${ideaPrefix}; the step was added without a link.`
              : `${ideaPrefix} matches ${linked.length} ideas; all were linked. Use more characters next time.`,
          );
        }
      }

      console.log(
        `${ref(row.number)} ${
          kind === 'decision'
            ? 'asked'
            : kind === SETUP_KIND
              ? 'for you to set up'
              : proposed
                ? 'proposed'
                : stamped
                  ? 'added ready to build'
                  : 'added'
        }${
          parent ? ` under ${ref(parent.number)}` : ` at the top of ${moduleLabel(scope)}`
        }${ideaPrefix ? ` from idea ${ideaPrefix}` : ''}.`,
      );
      await checkRowWriting(sql, userId, row, {
        title,
        detail: arg('--detail'),
        done_when: arg('--done-when'),
      });
      return;
    }

    /**
     * Something only the person can supply, written as a job of theirs.
     *
     * The move this replaces: mark the step you are on `blocked`, put the
     * request for the key in its ask, and hope somebody reads it. That buries
     * the ask inside work the person was never going to do, and setting the
     * key afterwards moves nothing, because a block on something outside the
     * plan waits for a person to clear it by hand.
     *
     * One command instead, doing both halves in one go: a setup step under
     * the feature that ran into it -- decision #599, option A -- and the
     * `plan_dependencies` row from the stopped work to it. After that the
     * plan says the true thing in both directions: the person has a job with
     * a summary and instructions, on /dev/plan and on the Dash tab, and the
     * work reads as waiting on that job rather than as a session stuck.
     * Closing the job is then the whole of freeing the work, since
     * `isReady` already frees a step once everything it waits on is done.
     *
     * The title is the one-line summary and `--detail` is what to actually
     * go and do: #598 draws them in exactly those two roles, so writing the
     * instructions as the title leaves the box labelled "What to set up"
     * saying nothing more than the heading above it.
     */
    if (command === 'needs') {
      const title = target?.trim();
      if (!title) {
        fail(
          'needs "<what to set>" --for <outline> [--detail "…"]. The title is the one-line summary — ' +
            '"Set GITHUB_TOKEN in Vercel" — and --detail is what to actually go and do.',
        );
      }
      const forNumber = arg('--for');
      if (!forNumber) {
        fail(
          'needs … --for <outline>: say which step is waiting on this, so the edge gets written. A ' +
            'setup job nothing waits on is a note, and the work goes on reading as stuck.',
        );
      }
      const waiting = await byNumber(sql, userId, forNumber);
      const refusal = needsRefusal({ ...waiting, outline: outlines.get(waiting.number) });
      if (refusal) fail(refusal);

      // The whole plan rather than a query per question: it is tens of rows,
      // and it answers the parent, the module and the last position at once.
      const data = await loadData(sql, userId);
      const parent = data.items.find((row) => row.id === waiting.parentId) ?? null;
      const home = setupHome(waiting, parent);
      const position =
        data.items
          .filter((row) => row.parentId === home.id)
          .reduce((highest, row) => Math.max(highest, row.position), 0) + 10;

      const detail = arg('--detail')?.trim() || null;
      const [row] = await sql<{ id: string; number: number }[]>`
        insert into plan_items (user_id, module, parent_id, title, detail, kind, priority,
                                assignee, status, position)
        values (${userId}, ${home.module}, ${home.id}, ${title}, ${detail}, ${SETUP_KIND}, 2,
                ${SETUP_ASSIGNEE}, 'not_started', ${position})
        returning id, number`;

      await sql`
        insert into plan_dependencies (user_id, item_id, depends_on_id)
        values (${userId}, ${waiting.id}, ${row.id})
        on conflict (item_id, depends_on_id) do nothing`;
      await loadOutlines(sql, userId, true);

      // A step that was blocked on this very thing stops being blocked: the
      // dependency now says what it is waiting for, and a step that says it
      // twice would need clearing twice.
      const released = releasesBlock(waiting.status);
      if (released) {
        await sql`
          update plan_items set status = 'not_started', block_ask = null, block_kind = null
          where id = ${waiting.id} and user_id = ${userId}`;
      }

      for (const line of needsLines({
        setupNumber: row.number,
        title,
        parentNumber: home.number,
        waitingNumber: waiting.number,
        released,
        hasDetail: detail !== null,
        setupOutline: outlines.get(row.number),
        parentOutline: outlines.get(home.number),
        waitingOutline: outlines.get(waiting.number),
      })) {
        console.log(readable(line));
      }
      await checkRowWriting(sql, userId, row, { title, detail });
      return;
    }

    const item = await byNumber(sql, userId, target);

    // Approval is the person's move. The command exists so a person at a
    // terminal has it; a session shaping or building never runs it.
    if (command === 'approve') {
      const rows = await sql<{ number: number }[]>`
        with recursive tree as (
          select id from plan_items where id = ${item.id} and user_id = ${userId}
          union all
          select p.id from plan_items p join tree on p.parent_id = tree.id
        )
        update plan_items set status = 'not_started'
        where id in (select id from tree) and status = 'proposed'
        returning number`;
      console.log(
        rows.length === 0
          ? `Nothing proposed at or under ${ref(item.number)}.`
          : `Approved ${rows.map((r) => `${ref(r.number)}`).join(', ')}.`,
      );
      return;
    }

    if (command === 'start') {
      if (item.status === 'proposed') {
        fail(`${ref(item.number)} is only proposed. A person approves it on /dev/plan first.`);
      }
      // The refusal this whole feature turns on. Making it the tool's rule
      // rather than the skill's is what stops a session that means well from
      // picking up its own question, reasoning its way to an answer, and
      // recording it as though somebody had decided.
      if (item.kind === 'decision') {
        fail(
          `${ref(item.number)} is a decision, not work. It is answered, not built, and only by a ` +
            `person: on /dev/plan, or with plan.ts answer ${typed(item.number)} --note "…".`,
        );
      }
      // And the same refusal for a setup job, for the same reason: the row
      // is there because a session cannot do it. Claiming one would put a
      // session in front of the wall the row was written to describe, and
      // the honest end of that is the step blocked again with the ask it
      // already had. Where it is closed is part of the refusal -- see
      // lib/plan/needs.ts.
      if (item.kind === SETUP_KIND) fail(setupStartRefusal(item.number, outlines.get(item.number)));

      // Claimed, and nothing written about who holds it.
      //
      // This used to fill an empty assignee with 'claude', because the daily
      // cron put back a claim with no assignee on the reading that nothing was
      // working it. #712 settled that the sweep reads the run behind the claim
      // instead, so claiming a step no longer says anything about the column
      // and the mark you put on a row survives a session working it.
      // A step being worked is not a step waiting on anything, so the
      // sentence saying what it needed and the word saying who could supply
      // it both go. The dated line that recorded the block stays in the
      // comment.
      await sql`
        update plan_items
        set status = 'in_progress', block_ask = null, block_kind = null
        where id = ${item.id} and user_id = ${userId}`;
      console.log(`${ref(item.number)} in progress.`);
      return;
    }

    if (command === 'reopen') {
      await sql`
        update plan_items set status = 'not_started', block_ask = null, block_kind = null
        where id = ${item.id} and user_id = ${userId}`;
      console.log(`${ref(item.number)} reopened.`);
      return;
    }

    // Why a session stopped without closing its step (plan #1802), written onto
    // the run it was sent as: the newest run fired at the step or a row above
    // it. A run still going is ended, since the session has said it is over.
    // `--piece`, given twice or more, is the split a too-big step would take.
    if (command === 'activity') {
      const parsed = runLine(arg('--kind'), arg('--body'), args('--option'));
      if ('refusal' in parsed) fail(parsed.refusal);
      const chain = await sql<{ id: string }[]>`
        with recursive chain as (
          select id, parent_id from plan_items where id = ${item.id} and user_id = ${userId}
          union all
          select p.id, p.parent_id from plan_items p
          join chain on p.id = chain.parent_id
          where p.user_id = ${userId}
        )
        select id from chain`;
      const ids = chain.map((row) => row.id);
      const rows = await sql<{ id: string; plan_item_id: string; status: string; created_at: Date }[]>`
        select id, plan_item_id, status, created_at from plan_runs
        where user_id = ${userId} and plan_item_id in ${sql(ids)}`;
      const run = runForStop(
        rows.map((row) => ({
          id: row.id,
          planItemId: row.plan_item_id,
          status: row.status,
          createdAt: row.created_at.toISOString(),
        })),
        ids,
      );
      // A session working by hand has no run; that is not an error to stop on.
      if (!run) {
        console.log(`No run was fired at #${item.number} or above it; no line written.`);
        return;
      }
      const { line } = parsed;
      await sql`
        insert into core.run_activities (user_id, run_table, run_id, kind, body, options)
        values (${userId}, 'plan_runs', ${run.id}, ${line.kind}, ${line.body},
                ${line.options === null ? null : sql.json(line.options)})`;
      const next = statusAfterLine(run.status, line.kind);
      if (next !== run.status) {
        await sql`update plan_runs set status = ${next} where id = ${run.id} and user_id = ${userId}`;
      }
      console.log(`#${item.number} run line (${line.kind}): ${line.body}`);
      return;
    }

    // The person's answer to the question the run asked (plan #1824): what a
    // session that asked with `activity --kind question` reads back to carry
    // on. Prints the answer, or says there is none yet.
    if (command === 'response') {
      const chain = await sql<{ id: string }[]>`
        with recursive chain as (
          select id, parent_id from plan_items where id = ${item.id} and user_id = ${userId}
          union all
          select p.id, p.parent_id from plan_items p
          join chain on p.id = chain.parent_id
          where p.user_id = ${userId}
        )
        select id from chain`;
      const ids = chain.map((row) => row.id);
      const rows = await sql<{ id: string; plan_item_id: string; status: string; created_at: Date }[]>`
        select id, plan_item_id, status, created_at from plan_runs
        where user_id = ${userId} and plan_item_id in ${sql(ids)}`;
      const run = runForStop(
        rows.map((row) => ({
          id: row.id,
          planItemId: row.plan_item_id,
          status: row.status,
          createdAt: row.created_at.toISOString(),
        })),
        ids,
      );
      if (!run) fail(`No run was fired at ${ref(item.number)} or above it, so nothing was asked.`);
      const lines = await sql<{ kind: string; body: string; created_at: Date }[]>`
        select kind, body, created_at from core.run_activities
        where user_id = ${userId} and run_id = ${run.id}
        order by created_at`;
      const heard = runResponse(lines.map((line) => ({ kind: line.kind, body: line.body })));
      console.log(heard);
      return;
    }

    if (command === 'stopped') {
      const reason = stopLine(arg('--reason'));
      const pieces = args('--piece').map(stopLine);
      const refusal = stopRefusal(reason, pieces);
      if (refusal) fail(refusal);
      if (item.status === 'done' || item.status === 'blocked') {
        fail(
          `${ref(item.number)} is ${item.status}, which already says how the run ended. A stop ` +
            `reason is for a run that ends with its step neither closed nor blocked.`,
        );
      }
      const chain = await sql<{ id: string }[]>`
        with recursive chain as (
          select id, parent_id from plan_items where id = ${item.id} and user_id = ${userId}
          union all
          select p.id, p.parent_id from plan_items p
          join chain on p.id = chain.parent_id
          where p.user_id = ${userId}
        )
        select id from chain`;
      const ids = chain.map((row) => row.id);
      const rows = await sql<{ id: string; plan_item_id: string; status: string; created_at: Date }[]>`
        select id, plan_item_id, status, created_at from plan_runs
        where user_id = ${userId} and plan_item_id in ${sql(ids)}`;
      const run = runForStop(
        rows.map((row) => ({
          id: row.id,
          planItemId: row.plan_item_id,
          status: row.status,
          createdAt: row.created_at.toISOString(),
        })),
        ids,
      );
      if (!run) fail(`No run was fired at ${ref(item.number)} or above it, so there is no run to explain.`);
      if (run.status === 'finished') {
        fail(`The last run on ${ref(item.number)} already reads finished; there is no stop to explain.`);
      }
      const columns = stopColumns(run, reason, pieces, new Date().toISOString());
      await sql`
        update plan_runs set ${sql(columns)}
        where id = ${run.id} and user_id = ${userId}`;
      console.log(`${ref(item.number)} last run stopped: ${reason}`);
      if (pieces.length > 0) {
        pieces.forEach((piece, index) => console.log(`  ${index + 1}. ${piece}`));
      }
      return;
    }

    /**
     * The other way a step closes: on an answer rather than a commit.
     *
     * The CLI half of the page's Answer box, writing the same columns and the
     * same dated line, so a decision settled at a terminal and one settled on
     * the page are indistinguishable afterwards. No commit is recorded --
     * nothing was built -- and a step that is not a decision is refused,
     * because `done` is what closes work and it already asks for a note.
     */
    if (command === 'answer') {
      const note = arg('--note');
      if (!note) fail('--note is required for answer: say what you decided.');
      if (item.kind !== 'decision') {
        fail(`${ref(item.number)} is work, not a question. Close it with done --note "…".`);
      }

      const stamp = new Date().toISOString().slice(0, 10);
      const line = `Answered ${stamp}: ${note}`;
      const comment = item.comment ? `${item.comment}\n\n${line}` : line;

      await sql`
        update plan_items
        set status = 'done', resolution = ${note}, comment = ${comment}, commit_sha = null,
            block_ask = null, block_kind = null
        where id = ${item.id} and user_id = ${userId}`;
      console.log(`${ref(item.number)} answered: ${note}`);

      const sections = await loadTree(sql, userId);
      const node = findNode(sections, item.id);
      const freed = node?.blocks.filter((ref) => findNode(sections, ref.id)?.ready) ?? [];
      if (freed.length > 0) {
        console.log(`Now ready: ${freed.map((step) => `${stepRef(step)} ${readable(step.title)}`).join(', ')}`);
      }
      return;
    }

    /**
     * A step built inside a feature batch, merged into the feature's branch
     * rather than main (the plan skill, "A feature, or more than one step").
     *
     * It cannot close yet: `done` refuses a commit that is not on main, and
     * that guard stays. So the step stays in progress and carries its commit
     * and a dated Built line saying which branch holds it. The branch is
     * pushed after every step, so the work outlives the session, and `land`
     * closes every built step once the feature's one merge reaches main.
     */
    if (command === 'built') {
      const note = arg('--note')?.trim();
      if (!note) fail(`built ${typed(item.number)} --note "what it built" [--commit <sha>]`);
      if (item.kind === 'decision' || item.kind === 'setup') {
        fail(`${ref(item.number)} is a ${item.kind === 'decision' ? 'decision' : 'setup job'}, not work a branch can hold.`);
      }
      if (item.status !== 'in_progress' && item.status !== 'not_started') {
        fail(`${ref(item.number)} is ${STATUS_WORD[item.status]}. Only a step being built can be marked built.`);
      }
      const commit = arg('--commit') ?? currentCommit();
      if (!commit) fail('No commit to record: pass --commit <sha>.');
      const branch = arg('--branch') ?? currentBranch();
      if (!branch || branch === 'main') {
        fail('built is for a step on its feature branch. A step on main closes with done.');
      }
      const stamp = new Date().toISOString().slice(0, 10);
      const line = `Built ${stamp} on ${branch} (${commit}): ${note}`;
      await sql`
        update plan_items
        set status = 'in_progress', commit_sha = ${commit},
            comment = ${item.comment ? `${item.comment}\n\n${line}` : line}
        where id = ${item.id} and user_id = ${userId}`;
      console.log(`${ref(item.number)} built on ${branch} (${commit}). It closes when its feature lands: plan.ts land <feature>.`);
      await checkRowWriting(sql, userId, item, { note });
      return;
    }

    /**
     * Close every step marked built under a feature, once the feature's
     * branch is on main. Each close runs the same checks as `done`, against
     * the commit `built` recorded, so a step whose commit did not land, or
     * whose screen has no passing design check, stays open and is named.
     */
    if (command === 'land') {
      const rows = await sql<Record<string, unknown>[]>`
        with recursive tree as (
          select id from plan_items where id = ${item.id} and user_id = ${userId}
          union all
          select p.id from plan_items p join tree on p.parent_id = tree.id
        )
        select id, number, comment, commit_sha from plan_items
        where id in (select id from tree) and user_id = ${userId}
          and status = 'in_progress' and commit_sha is not null
        order by position, created_at`;
      const built = rows.filter((row) => {
        const paragraphs = String(row.comment ?? '').split(/\n\n/);
        return BUILT_LINE.test(paragraphs[paragraphs.length - 1]?.trim() ?? '');
      });
      if (built.length === 0) fail(`Nothing under ${ref(item.number)} is marked built.`);

      const stamp = new Date().toISOString().slice(0, 10);
      const closed: number[] = [];
      const refused: string[] = [];
      for (const row of built) {
        const number = row.number as number;
        const commit = row.commit_sha as string;
        const refusal = await doneRefusal(sql, userId, number, commit);
        if (refusal) {
          refused.push(`${ref(number)}: ${refusal}`);
          continue;
        }
        const line = `Done ${stamp}: on main with ${ref(item.number)}.`;
        await sql`
          update plan_items
          set status = 'done', comment = coalesce(comment || E'\n\n', '') || ${line}
          where id = ${row.id as string} and user_id = ${userId}`;
        closed.push(number);
      }
      if (closed.length > 0) console.log(`Closed ${closed.map((n) => ref(n)).join(', ')}.`);
      if (refused.length > 0) {
        console.error(readable(`Still open:\n${refused.join('\n')}`));
        process.exit(1);
      }
      return;
    }

    // Closing or parking a step always records why. A status with no reason
    // is how a plan becomes something nobody trusts.
    if (command === 'done' || command === 'block' || command === 'drop') {
      // A block says two things and they have different lifetimes. What the
      // step needs is one sentence that is true until somebody supplies it, so
      // it goes in its own column and is rewritten on every block. Everything
      // else -- what was tried, what was ruled out, what the last block asked
      // for -- is history, and history is appended. Blocking with only a note
      // is refused rather than guessed at, because a note is where the ask
      // used to get lost.
      const ask = command === 'block' ? arg('--ask')?.trim() : undefined;
      if (command === 'block' && !ask) {
        fail(
          `block ${typed(item.number)} --ask "what it needs, in one sentence" [--on-steps] ` +
            `[--note "the rest"]. The ask is what Dash and the plan row show, and blocking ` +
            `again replaces it; --note is the dated line, which is appended. --on-steps says ` +
            `the block is waiting on the steps it names and should clear itself when they ` +
            `close; without it the block waits for you.`,
        );
      }
      // Which kind of block, which decides who clears it. A session parking
      // its own step behind a question it may not answer says --on-steps and
      // adds the dependency edge, so the step comes back on its own when the
      // question is answered. Everything else -- a key, an account, a DNS
      // record -- waits for the person, which is the default and the safe way
      // to be wrong: #499 read as ready for a day because a block about a
      // GitHub token cleared itself off unrelated steps closing.
      const onSteps = command === 'block' && has('--on-steps');
      if (command === 'block' && ask) {
        const refusal = blockAskRefusal(ask, onSteps);
        if (refusal) fail(refusal);
      }
      const note = arg('--note') ?? ask;
      if (!note) fail(`--note is required for ${command}: say what happened.`);

      const status: PlanStatus = command === 'done' ? 'done' : command === 'block' ? 'blocked' : 'dropped';
      const commit = command === 'done' ? (arg('--commit') ?? currentCommit()) : null;

      if (command === 'done' && commit) {
        const refusal = await doneRefusal(sql, userId, item.number, commit);
        if (refusal) fail(refusal);
      }

      const stamp = new Date().toISOString().slice(0, 10);
      const line = `${STATUS_WORD[status][0].toUpperCase()}${STATUS_WORD[status].slice(1)} ${stamp}: ${note}`;
      const comment = item.comment ? `${item.comment}\n\n${line}` : line;

      // Cleared on done and on drop: a sentence saying what a step needs is a
      // claim about work that has stopped, and it stops being true the moment
      // the step moves on.
      await sql`
        update plan_items
        set status = ${status}, comment = ${comment},
            commit_sha = coalesce(${commit}, commit_sha),
            block_ask = ${ask ?? null},
            block_kind = ${blockPatch(status, onSteps ? 'steps' : null).block_kind}
        where id = ${item.id} and user_id = ${userId}`;
      console.log(`${ref(item.number)} ${STATUS_WORD[status]}${commit ? ` (${commit})` : ''}: ${note}`);
      if (ask && ask !== note) console.log(`Needs: ${ask}`);
      await checkRowWriting(sql, userId, item, ask && ask !== note ? { ask, note } : { note });
      if (status === 'blocked') {
        console.log(
          onSteps
            ? 'Waiting on the steps it names: it clears itself when they close.'
            : 'Waiting on you: it stays blocked until you say otherwise.',
        );
      }

      if (command === 'done') {
        const sections = await loadTree(sql, userId);
        const node = findNode(sections, item.id);
        const freed = node?.blocks.filter((ref) => findNode(sections, ref.id)?.ready) ?? [];
        if (freed.length > 0) {
          console.log(`Now ready: ${freed.map((step) => `${stepRef(step)} ${readable(step.title)}`).join(', ')}`);
        }
      }
      return;
    }

    // Dash's update on a feature (plan #1666): what a build or re-shape run
    // says about the feature it worked, at the end of the run. The counts are
    // worked out here, from the plan as it now stands, so the run only says
    // the health and what moved.
    if (command === 'update') {
      const health = arg('--health')?.trim();
      const body = arg('--body')?.trim();
      if (!isPlanUpdateHealth(health) || !body) {
        fail(
          `update ${typed(item.number)} --health ${PLAN_UPDATE_HEALTHS.join('|')} --body "two or three ` +
            `sentences on what moved". Name the feature, not the step the run closed.`,
        );
      }
      if (body.length > PLAN_UPDATE_BODY_MAX) {
        fail(`The body is ${body.length} characters; keep it under ${PLAN_UPDATE_BODY_MAX}.`);
      }
      if (item.parentId !== null) {
        fail(
          `${ref(item.number)} is a step. An update is on a feature: name the top-level row ` +
            `the step sits under.`,
        );
      }
      const sections = await loadTree(sql, userId);
      const feature = findNode(sections, item.id);
      if (!feature) fail(`${ref(item.number)} is not on the plan as it is read.`);
      const [last] = await sql<{ created_at: Date }[]>`
        select created_at from plan_updates
        where user_id = ${userId} and feature_id = ${item.id}
        order by created_at desc limit 1`;
      const counts = updateCounts(feature, last ? last.created_at.toISOString() : null, Date.now());
      const runId = arg('--run')?.trim() || null;
      await sql`
        insert into plan_updates (user_id, feature_id, health, body, steps_done_before,
                                  steps_done_after, steps_total, run_id, session)
        values (${userId}, ${item.id}, ${health}, ${body}, ${counts.before}, ${counts.after},
                ${counts.total}, ${runId}, ${currentSession(process.env) ?? null})`;
      console.log(
        `${ref(item.number)} ${PLAN_UPDATE_HEALTH[health].word.toLowerCase()}: ${progressSince({
          stepsDoneBefore: counts.before,
          stepsDoneAfter: counts.after,
          stepsTotal: counts.total,
        })}`,
      );
      await checkRowWriting(sql, userId, item, { note: body });
      return;
    }

    if (command === 'assign') {
      const who = extra;
      if (!who || !['me', 'none'].includes(who)) fail('assign <outline> me|none');
      await sql`
        update plan_items set assignee = ${who === 'none' ? null : who}
        where id = ${item.id} and user_id = ${userId}`;
      console.log(`${ref(item.number)} ${who === 'none' ? 'unassigned' : `→ ${who}`}.`);
      return;
    }

    if (command === 'priority') {
      const value = Number(extra);
      if (!isPlanPriority(value)) fail('Priority is 1 (next), 2 (normal) or 3 (someday).');
      await sql`update plan_items set priority = ${value} where id = ${item.id} and user_id = ${userId}`;
      console.log(`${ref(item.number)} priority ${value}.`);
      return;
    }

    if (command === 'depends' || command === 'undepend') {
      const other = await byNumber(sql, userId, arg('--on') ?? undefined);
      if (command === 'depends') {
        await sql`
          insert into plan_dependencies (user_id, item_id, depends_on_id)
          values (${userId}, ${item.id}, ${other.id})
          on conflict (item_id, depends_on_id) do nothing`;
        console.log(`${ref(item.number)} waits on ${ref(other.number)}.`);
      } else {
        await sql`
          delete from plan_dependencies
          where user_id = ${userId} and item_id = ${item.id} and depends_on_id = ${other.id}`;
        console.log(`${ref(item.number)} no longer waits on ${ref(other.number)}.`);
      }
      return;
    }

    fail(`Unknown command "${command}".`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
