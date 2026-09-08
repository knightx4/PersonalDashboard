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
 *                                [--detail "…"] [--done-when "…"]
 *                                [--proposed] [--idea <id prefix>]
 *   npx tsx scripts/plan.ts ideas                       # ideas not yet shaped into the plan
 *   npx tsx scripts/plan.ts approve <n>                 # a person's move, never a session's
 *   npx tsx scripts/plan.ts start <n>
 *   npx tsx scripts/plan.ts done <n> --note "what shipped" [--commit <sha>]
 *   npx tsx scripts/plan.ts block <n> --note "what it is waiting on"
 *   npx tsx scripts/plan.ts drop <n> --note "why not"
 *   npx tsx scripts/plan.ts reopen <n>
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
import postgres from 'postgres';
import { MODULES, isModuleId } from '../lib/modules';
import { planBrief, STATUS_WORD } from '../lib/plan/brief';
import {
  isClosed,
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
    select id, number, module, parent_id, title, detail, acceptance, status, comment,
           priority, size, assignee, commit_sha, position, started_at, completed_at, created_at
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
    select id, number, module, parent_id, title, detail, acceptance, status, comment,
           priority, size, assignee, commit_sha, position, started_at, completed_at, created_at
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
  const head = `${indent}#${String(node.number).padEnd(4)}${GLYPH[node.status]}  ${node.title}`;
  const tail = facts(node);
  console.log(tail ? `${head.padEnd(64)}  ${tail}` : head);
  for (const child of node.children) printNode(child, indent + '  ');
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
          `${summary.waiting} waiting, ${summary.claude} with Claude. ${summary.done} done.`,
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

      const [row] = await sql<{ id: string; number: number }[]>`
        insert into plan_items (user_id, module, parent_id, title, detail, acceptance,
                                priority, size, assignee, status, position)
        values (${userId}, ${scope}, ${parent?.id ?? null}, ${title},
                ${arg('--detail')}, ${arg('--done-when')},
                ${priority}, ${size}, ${has('--claude') ? 'claude' : null},
                ${proposed ? 'proposed' : 'not_started'},
                ${(last?.position ?? 0) + 10})
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
        `#${row.number} ${proposed ? 'proposed' : 'added'}${
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
      await sql`update plan_items set status = 'in_progress' where id = ${item.id} and user_id = ${userId}`;
      console.log(`#${item.number} in progress.`);
      return;
    }

    if (command === 'reopen') {
      await sql`update plan_items set status = 'not_started' where id = ${item.id} and user_id = ${userId}`;
      console.log(`#${item.number} reopened.`);
      return;
    }

    // Closing or parking a step always records why. A status with no reason
    // is how a plan becomes something nobody trusts.
    if (command === 'done' || command === 'block' || command === 'drop') {
      const note = arg('--note');
      if (!note) fail(`--note is required for ${command}: say what happened.`);
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
