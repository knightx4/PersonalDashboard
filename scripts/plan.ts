/**
 * The plan: read and update what is being built.
 *
 * This is how a session works the plan rather than the notes queue -- the
 * same rows /dev/plan shows, read and written from a terminal, so that what
 * a person decided on the page is what a session picks up, and what the
 * session did is on the page the moment it is done.
 *
 *   npx tsx scripts/plan.ts list [--all] [--module <id>] [--claude]
 *   npx tsx scripts/plan.ts next [--claude] [--limit <n>]
 *   npx tsx scripts/plan.ts show <n>
 *   npx tsx scripts/plan.ts add "<title>" [--parent <n>] [--module <id>]
 *                                [--priority 1|2|3] [--size s|m|l] [--claude]
 *                                [--detail "…"] [--done-when "…"] [--fog "…"]
 *                                [--proposed] [--idea <id prefix>]
 *                                [--kind decision] [--from <n>]
 *   npx tsx scripts/plan.ts ideas                       # ideas not yet shaped into the plan
 *   npx tsx scripts/plan.ts idea "<body>" [--module <id>]  # file one idea
 *   npx tsx scripts/plan.ts idea --file <path.md>       # file every "## " section of a file
 *   npx tsx scripts/plan.ts raise "<title>" [--detail "…"] [--module <id>]
 *                                [--from <n>] [--source "…"]   # ask the person something
 *   npx tsx scripts/plan.ts raises                      # open raises, and answers not replied to
 *   npx tsx scripts/plan.ts approve <n>                 # a person's move, never a session's
 *   npx tsx scripts/plan.ts start <n>
 *   npx tsx scripts/plan.ts done <n> --note "what shipped" [--commit <sha>]
 *   npx tsx scripts/plan.ts answer <n> --note "what was decided"   # a decision
 *   npx tsx scripts/plan.ts block <n> --note "what it is waiting on"
 *   npx tsx scripts/plan.ts drop <n> --note "why not"
 *   npx tsx scripts/plan.ts reopen <n>
 *   npx tsx scripts/plan.ts fog <n> --note "what cannot be seen yet" | --clear
 *   npx tsx scripts/plan.ts assign <n> me|claude|none
 *   npx tsx scripts/plan.ts priority <n> 1|2|3
 *   npx tsx scripts/plan.ts depends <n> --on <m>
 *   npx tsx scripts/plan.ts undepend <n> --on <m>
 *
 * Steps are named by their number -- the "#12" on the page -- which is never
 * reused, so a number in a commit message stays meaningful.
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
import { MODULES, isModuleId } from '../lib/modules';
import { planBrief, STATUS_WORD } from '../lib/plan/brief';
import { reshapeStamp } from '../lib/plan/origin';
import {
  isClosed,
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
  summarize,
  workOrder,
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

const argv = process.argv.slice(2);

function arg(flag: string): string | null {
  const index = argv.indexOf(flag);
  return index > -1 ? (argv[index + 1] ?? null) : null;
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
  console.error(message);
  process.exit(1);
}

function currentCommit(): string | null {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return null;
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
    select id, number, module, parent_id, title, detail, acceptance, status, kind, fog,
           resolution, comment, priority, size, assignee, commit_sha, position,
           started_at, completed_at, created_at
    from plan_items where user_id = ${userId}
    order by position, created_at`;
  const deps = await sql<{ id: string; item_id: string; depends_on_id: string }[]>`
    select id, item_id, depends_on_id from plan_dependencies where user_id = ${userId}`;
  return {
    items: rows.map(planItemFromRow),
    dependencies: deps.map((d) => ({ id: d.id, itemId: d.item_id, dependsOnId: d.depends_on_id })),
  };
}

async function loadTree(sql: Sql, userId: string): Promise<PlanSection[]> {
  return buildPlanTree(await loadData(sql, userId));
}

async function byNumber(sql: Sql, userId: string, raw: string | undefined): Promise<PlanItem> {
  const number = Number(String(raw ?? '').replace(/^#/, ''));
  if (!Number.isInteger(number) || number < 1) fail('Give a step number, the "#12" on the page.');
  const rows = await sql<Record<string, unknown>[]>`
    select id, number, module, parent_id, title, detail, acceptance, status, kind, fog,
           resolution, comment, priority, size, assignee, commit_sha, position,
           started_at, completed_at, created_at
    from plan_items where user_id = ${userId} and number = ${number}`;
  if (rows.length === 0) fail(`No step #${number}.`);
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

function facts(node: PlanNode): string {
  const out: string[] = [];
  // First, because it changes what every other fact on the line means: a
  // question that is "ready" is ready for the person, not for a session.
  if (node.kind === 'decision') out.push(node.status === 'done' ? 'answered' : 'DECISION');
  if (node.priority !== 2) out.push(`p${node.priority}`);
  if (node.size) out.push(node.size.toUpperCase());
  if (node.assignee) out.push(node.assignee);
  if (node.waitingOn.length > 0 && !isClosed(node.status)) {
    out.push(`waits ${node.waitingOn.map((ref) => `#${ref.number}`).join(',')}`);
  }
  if (node.children.length > 0 && node.rollup.live > 0) {
    out.push(`${node.rollup.done}/${node.rollup.live}`);
  }
  if (node.ready) out.push('ready');
  return out.join('  ');
}

function printNode(node: PlanNode, indent = ''): void {
  // An unanswered decision gets "[?]" where a build step gets its status box,
  // so a session scanning the list sees what is a question before it reads a
  // word of the title. An answered one keeps "[x]": it is closed either way.
  // Round rather than square, and unlike the "[?]" a proposal wears: this is
  // not a box waiting to be ticked, it is a question waiting to be answered.
  const glyph = node.kind === 'decision' && !isClosed(node.status) ? '(?)' : GLYPH[node.status];
  const head = `${indent}#${String(node.number).padEnd(4)}${glyph}  ${node.title}`;
  const tail = facts(node);
  console.log(tail ? `${head.padEnd(64)}  ${tail}` : head);
  // The admission that part of this is not yet planned, on the line under it.
  if (node.fog) console.log(`${indent}      fog: ${node.fog.replace(/\s+/g, ' ').slice(0, 100)}`);
  for (const child of node.children) printNode(child, indent + '  ');
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
  return module ? (MODULES.find((m) => m.id === module)?.label ?? module) : 'The app as a whole';
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

function printRaise(row: RaisedListRow): void {
  const scope = row.module && isModuleId(row.module) ? row.module : null;
  console.log(`\n${row.id.slice(0, 8)}  ${moduleLabel(scope)}  ${row.title}`);
  if (row.source) console.log(`  raised by ${row.source}`);
  // The ask above the story, the same order the page reads it in.
  if (row.ask) console.log(`  asks: ${row.ask.replace(/\s+/g, ' ')}`);
  if (row.detail) console.log(`  ${row.detail.replace(/\s+/g, ' ')}`);
  for (const comment of row.comments ?? []) {
    console.log(`  ${comment.author === 'me' ? 'user' : 'claude'}: ${comment.body.replace(/\s+/g, ' ')}`);
  }
}

async function main(): Promise<void> {
  const [command = 'list', target, extra] = positional();
  const sql = connect();
  const userId = await resolveUser(sql);

  try {
    if (command === 'list') {
      const sections = await loadTree(sql, userId);
      const all = has('--all');
      const onlyModule = arg('--module');
      const claude = has('--claude');
      let shown = 0;

      for (const section of sections) {
        if (onlyModule && section.module !== onlyModule) continue;
        const nodes = keep(
          section.nodes,
          (node) => (all || !isClosed(node.status)) && (!claude || node.assignee === 'claude'),
        );
        if (nodes.length === 0) continue;
        const { done, live } = section.progress;
        console.log(`\n== ${section.label}${live ? ` (${done} of ${live} done)` : ''}`);
        for (const node of nodes) printNode(node);
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
      const rows = await sql<{ id: string; body: string; module: string | null; created_at: Date }[]>`
        select id, body, module, created_at from ideas
        where user_id = ${userId} and plan_item_id is null
        order by created_at desc`;
      if (rows.length === 0) {
        console.log('Every idea has been shaped into the plan, or there are none.');
        return;
      }
      for (const row of rows) {
        const scope = row.module && isModuleId(row.module) ? row.module : null;
        console.log(
          `${row.id.slice(0, 8)}  ${moduleLabel(scope).padEnd(18)}  ${row.body.replace(/\s+/g, ' ').slice(0, 90)}`,
        );
      }
      return;
    }

    if (command === 'idea') {
      const file = arg('--file');
      const moduleArg = arg('--module');
      if (moduleArg && !isModuleId(moduleArg)) fail(`"${moduleArg}" is not a module.`);
      const ideas = file
        ? ideasFromFile(file)
        : target?.trim()
          ? [{ body: target.trim(), module: moduleArg && isModuleId(moduleArg) ? moduleArg : null }]
          : [];
      if (ideas.length === 0) {
        fail('Give the idea: idea "…" [--module <id>], or idea --file <path> with a "## " heading per idea.');
      }
      for (const idea of ideas) {
        if (idea.body.length > 4000) fail(`An idea is at most 4000 characters: "${idea.body.slice(0, 40)}…"`);
        const [row] = await sql<{ id: string }[]>`
          insert into ideas (user_id, body, module)
          values (${userId}, ${idea.body}, ${idea.module})
          returning id`;
        console.log(`${row.id.slice(0, 8)}  ${moduleLabel(idea.module).padEnd(18)}  ${idea.body.replace(/\s+/g, ' ').slice(0, 90)}`);
      }
      console.log(`\n${ideas.length} filed. They are on /dev/ideas.`);
      return;
    }

    /**
     * Raising something, which is a session asking you for what belongs to no
     * step: a risk it found in code it was only passing through, a question of
     * taste, a thing it will not decide alone. A decision belongs to one
     * feature and the notes queue is what you report as wrong; this is the
     * third home, and it is read on /dev/raised.
     *
     * A session never answers or dismisses its own raise, the same rule as
     * never answering its own decision, so there is no command for either.
     */
    if (command === 'raise') {
      const title = target?.trim();
      if (!title) fail('Give the raise: raise "…" --ask "…" [--detail "…"] [--module <id>] [--from <n>].');
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

      const from = arg('--from');
      const step = from ? await byNumber(sql, userId, from) : null;
      const source = arg('--source') ?? (step ? `plan #${step.number}` : null);

      const [row] = await sql<{ id: string }[]>`
        insert into raised_items (user_id, module, title, detail, ask, source)
        values (${userId}, ${moduleArg && isModuleId(moduleArg) ? moduleArg : null}, ${title},
                ${detail}, ${ask}, ${source})
        returning id`;
      console.log(`${row.id.slice(0, 8)}  raised: ${title}`);
      console.log('It is on /dev/raised, and in the bell until it is answered or dismissed.');
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
        select r.id, r.title, r.detail, r.ask, r.module, r.source, r.status, r.created_at,
               (
                 select json_agg(
                          json_build_object('author', c.author, 'body', c.body)
                          order by c.created_at
                        )
                 from raised_comments c where c.raised_item_id = r.id
               ) as comments
        from raised_items r
        where r.user_id = ${userId} and r.status in ('open', 'answered')
        order by r.created_at desc`;

      const open = rows.filter((row) => row.status === 'open');
      const answered = rows.filter(
        (row) => row.status === 'answered' && lastAuthor(row) === 'me',
      );

      if (open.length === 0 && answered.length === 0) {
        console.log('Nothing raised is waiting, and every answer has been replied to.');
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
      return;
    }

    if (command === 'next') {
      const sections = await loadTree(sql, userId);
      const claude = has('--claude');
      const limit = Number(arg('--limit') ?? 10);
      const order = workOrder(sections, claude ? { assignee: 'claude' } : {});

      if (order.length === 0) {
        const summary = summarize(sections);
        console.log(
          claude
            ? 'Nothing handed to Claude is ready. Hand a step over on /dev/plan, or run without --claude.'
            : `Nothing is ready. ${summary.inProgress} underway, ${summary.waiting} waiting.`,
        );
        return;
      }
      for (const node of order.slice(0, limit)) {
        const head = `#${String(node.number).padEnd(4)}p${node.priority}  ${node.title}`;
        console.log(`${head.padEnd(64)}  ${moduleLabel(node.module)}${facts(node) ? `  ${facts(node)}` : ''}`);
      }
      if (order.length > limit) console.log(`… and ${order.length - limit} more.`);
      return;
    }

    if (command === 'show' || command === 'brief') {
      const item = await byNumber(sql, userId, target);
      const sections = await loadTree(sql, userId);
      const node = findNode(sections, item.id);
      if (!node) fail(`#${item.number} is not in the tree.`);
      process.stdout.write(planBrief(sections, node));
      return;
    }

    if (command === 'add') {
      const title = target?.trim();
      if (!title) fail('Give the step a title: add "What has to happen".');
      const parentNumber = arg('--parent');
      const parent = parentNumber ? await byNumber(sql, userId, parentNumber) : null;
      const moduleArg = arg('--module');
      if (moduleArg && !isModuleId(moduleArg)) fail(`"${moduleArg}" is not a module.`);
      const scope = parent ? parent.module : moduleArg && isModuleId(moduleArg) ? moduleArg : null;
      const priority = Number(arg('--priority') ?? 2);
      if (!isPlanPriority(priority)) fail('Priority is 1 (next), 2 (normal) or 3 (someday).');
      const size = arg('--size');
      if (size && !isPlanSize(size)) fail('Size is s, m or l.');
      const kind = arg('--kind') ?? 'build';
      if (!isPlanKind(kind)) fail('Kind is build or decision.');

      const [last] = parent
        ? await sql<{ position: number }[]>`
            select position from plan_items where user_id = ${userId} and parent_id = ${parent.id}
            order by position desc limit 1`
        : await sql<{ position: number }[]>`
            select position from plan_items
            where user_id = ${userId} and parent_id is null and module is not distinct from ${scope}
            order by position desc limit 1`;

      // A step under a proposed parent is a proposal too, whatever the flag
      // said: a decided step inside an undecided feature is a contradiction.
      const proposed = has('--proposed') || parent?.status === 'proposed';

      // A decision is never assigned to Claude, whatever --claude said. The
      // whole guarantee is that a session cannot pick up its own question, and
      // it is worth more enforced here than remembered at the call site.
      const assignee = kind === 'decision' ? null : has('--claude') ? 'claude' : null;

      // Where the row came from, when it did not come from a person. The gist
      // is read off the decision's own answer rather than retyped by whoever
      // is adding the step, so a session cannot paraphrase an answer into
      // something that was never said.
      const fromNumber = arg('--from');
      let comment: string | null = null;
      if (fromNumber) {
        const from = await byNumber(sql, userId, fromNumber);
        if (from.kind !== 'decision') fail(`#${from.number} is not a decision.`);
        if (!from.resolution) fail(`#${from.number} has not been answered yet.`);
        comment = reshapeStamp(from.number, from.resolution);
      }

      const [row] = await sql<{ id: string; number: number }[]>`
        insert into plan_items (user_id, module, parent_id, title, detail, acceptance,
                                fog, kind, priority, size, assignee, status, position,
                                comment)
        values (${userId}, ${scope}, ${parent?.id ?? null}, ${title},
                ${arg('--detail')}, ${arg('--done-when')}, ${arg('--fog')}, ${kind},
                ${priority}, ${size}, ${assignee},
                ${proposed ? 'proposed' : 'not_started'},
                ${(last?.position ?? 0) + 10}, ${comment})
        returning id, number`;

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
        `#${row.number} ${kind === 'decision' ? 'asked' : proposed ? 'proposed' : 'added'}${
          parent ? ` under #${parent.number}` : ` at the top of ${moduleLabel(scope)}`
        }${ideaPrefix ? ` from idea ${ideaPrefix}` : ''}.`,
      );
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
          ? `Nothing proposed at or under #${item.number}.`
          : `Approved ${rows.map((r) => `#${r.number}`).join(', ')}.`,
      );
      return;
    }

    if (command === 'start') {
      if (item.status === 'proposed') {
        fail(`#${item.number} is only proposed. A person approves it on /dev/plan first.`);
      }
      // The refusal this whole feature turns on. Making it the tool's rule
      // rather than the skill's is what stops a session that means well from
      // picking up its own question, reasoning its way to an answer, and
      // recording it as though somebody had decided.
      if (item.kind === 'decision') {
        fail(
          `#${item.number} is a decision, not work. It is answered, not built, and only by a ` +
            `person: on /dev/plan, or with plan.ts answer ${item.number} --note "…".`,
        );
      }
      await sql`update plan_items set status = 'in_progress' where id = ${item.id} and user_id = ${userId}`;
      console.log(`#${item.number} in progress.`);
      return;
    }

    if (command === 'reopen') {
      await sql`update plan_items set status = 'not_started' where id = ${item.id} and user_id = ${userId}`;
      console.log(`#${item.number} reopened.`);
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
        fail(`#${item.number} is work, not a question. Close it with done --note "…".`);
      }

      const stamp = new Date().toISOString().slice(0, 10);
      const line = `Answered ${stamp}: ${note}`;
      const comment = item.comment ? `${item.comment}\n\n${line}` : line;

      await sql`
        update plan_items
        set status = 'done', resolution = ${note}, comment = ${comment}, commit_sha = null
        where id = ${item.id} and user_id = ${userId}`;
      console.log(`#${item.number} answered: ${note}`);

      const sections = await loadTree(sql, userId);
      const node = findNode(sections, item.id);
      const freed = node?.blocks.filter((ref) => findNode(sections, ref.id)?.ready) ?? [];
      if (freed.length > 0) {
        console.log(`Now ready: ${freed.map((ref) => `#${ref.number} ${ref.title}`).join(', ')}`);
      }
      return;
    }

    /**
     * Writing and clearing the "not yet specified" note.
     *
     * `add --fog` could write it and nothing could ever touch it again, which
     * made fog a thing you could only get wrong once. It also made the return
     * trip impossible: graduating a patch of fog into steps means clearing it
     * in the same breath, and a session working without the page -- which is
     * every routine session, since DATABASE_URL is unset there -- had no way
     * to do the second half.
     *
     * Not a status change and not a close, so no dated line in the comment:
     * fog is a description of the step, and the description simply becomes
     * accurate or stops being needed. What replaced it is legible from the
     * steps that appeared, which is the point of graduating it.
     */
    if (command === 'fog') {
      const note = arg('--note')?.trim();
      const clear = has('--clear');
      if (clear && note) fail('Either --note or --clear, not both.');
      if (!clear && !note) {
        fail(`fog ${item.number} --note "what cannot be seen yet", or --clear once it can.`);
      }

      await sql`
        update plan_items set fog = ${clear ? null : (note ?? null)}
        where id = ${item.id} and user_id = ${userId}`;
      console.log(
        clear
          ? `#${item.number} fog cleared${item.fog ? '' : ' (it had none)'}.`
          : `#${item.number} fog: ${note}`,
      );
      return;
    }

    // Closing or parking a step always records why. A status with no reason
    // is how a plan becomes something nobody trusts.
    if (command === 'done' || command === 'block' || command === 'drop') {
      const note = arg('--note');
      if (!note) fail(`--note is required for ${command}: say what happened.`);

      // Fog on a step being closed as done is work that was never specified
      // sitting on work that is finished. Nothing reads it again from there.
      // Graduating it is the re-shape's first move; clearing it is one
      // command. Blocking and dropping are fine: neither claims the step is
      // complete.
      if (command === 'done' && item.fog) {
        fail(
          `#${item.number} still says part of it is not specified. Write the steps that ` +
            `patch covers, or run plan.ts fog ${item.number} --clear, then close it.`,
        );
      }
      const status: PlanStatus = command === 'done' ? 'done' : command === 'block' ? 'blocked' : 'dropped';
      const commit = command === 'done' ? (arg('--commit') ?? currentCommit()) : null;
      const stamp = new Date().toISOString().slice(0, 10);
      const line = `${STATUS_WORD[status][0].toUpperCase()}${STATUS_WORD[status].slice(1)} ${stamp}: ${note}`;
      const comment = item.comment ? `${item.comment}\n\n${line}` : line;

      await sql`
        update plan_items
        set status = ${status}, comment = ${comment},
            commit_sha = coalesce(${commit}, commit_sha)
        where id = ${item.id} and user_id = ${userId}`;
      console.log(`#${item.number} ${STATUS_WORD[status]}${commit ? ` (${commit})` : ''}: ${note}`);

      if (command === 'done') {
        const sections = await loadTree(sql, userId);
        const node = findNode(sections, item.id);
        const freed = node?.blocks.filter((ref) => findNode(sections, ref.id)?.ready) ?? [];
        if (freed.length > 0) {
          console.log(`Now ready: ${freed.map((ref) => `#${ref.number} ${ref.title}`).join(', ')}`);
        }
      }
      return;
    }

    if (command === 'assign') {
      const who = extra;
      if (!who || !['me', 'claude', 'none'].includes(who)) fail('assign <n> me|claude|none');
      await sql`
        update plan_items set assignee = ${who === 'none' ? null : who}
        where id = ${item.id} and user_id = ${userId}`;
      console.log(`#${item.number} ${who === 'none' ? 'unassigned' : `→ ${who}`}.`);
      return;
    }

    if (command === 'priority') {
      const value = Number(extra);
      if (!isPlanPriority(value)) fail('Priority is 1 (next), 2 (normal) or 3 (someday).');
      await sql`update plan_items set priority = ${value} where id = ${item.id} and user_id = ${userId}`;
      console.log(`#${item.number} priority ${value}.`);
      return;
    }

    if (command === 'depends' || command === 'undepend') {
      const other = await byNumber(sql, userId, arg('--on') ?? undefined);
      if (command === 'depends') {
        await sql`
          insert into plan_dependencies (user_id, item_id, depends_on_id)
          values (${userId}, ${item.id}, ${other.id})
          on conflict (item_id, depends_on_id) do nothing`;
        console.log(`#${item.number} waits on #${other.number}.`);
      } else {
        await sql`
          delete from plan_dependencies
          where user_id = ${userId} and item_id = ${item.id} and depends_on_id = ${other.id}`;
        console.log(`#${item.number} no longer waits on #${other.number}.`);
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
